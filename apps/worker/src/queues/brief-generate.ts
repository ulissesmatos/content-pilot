import { briefs, eq, resolveTaskModel, runItems, runs, sites, type Db } from '@content-pilot/db';
import {
  checkTopicAlreadyCovered,
  injectInlineImages,
  jobLlmConfigSchema,
  PlanLimitError,
  runPipeline,
  slugify,
  suggestedInlineCount,
} from '@content-pilot/core';
import {
  resolveLlmProvider,
  resolveSearchClient,
  resolveTemplateById,
  resolveWordPressAdapter,
} from '../lib/resolve';
import { makeBudgetGuard, maybeFinalizeRun, recordLlmCalls } from '../lib/run-helpers';
import { assertPlanAllowsGeneration } from '../lib/plan-guard';
import { illustratePost } from '../lib/illustrate-post';
import { createRunLogger } from '../lib/run-logger';
import type { BriefGeneratePayload } from './names';

/**
 * brief.generate: gera um post NOVO a partir de uma pauta (mode 'generate' do
 * pipeline: pesquisa Tavily → LLM → verificação → validação) e cria o post no
 * WordPress como rascunho ou publicado, conforme o publishMode da pauta.
 */
export async function handleBriefGenerate(db: Db, payload: BriefGeneratePayload) {
  const { briefId, runId } = payload;
  const startedAt = Date.now();

  const [run] = await db.select({ status: runs.status }).from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run || run.status !== 'running') {
    console.log(`[brief ${briefId}] run não está em execução — abortando`);
    return;
  }

  const [brief] = await db.select().from(briefs).where(eq(briefs.id, briefId)).limit(1);
  if (!brief) throw new Error(`brief ${briefId} não existe`);
  const workspaceId = brief.workspaceId;
  const logger = createRunLogger(db, runId, `[brief ${briefId}]`);
  const log = logger.log;

  await db.update(runs).set({ expectedItems: 1 }).where(eq(runs.id, runId));
  log(`geração da pauta "${brief.topic}" iniciada`);

  const fail = async (error: string) => {
    await db
      .update(briefs)
      .set({ status: 'failed', error, updatedAt: new Date() })
      .where(eq(briefs.id, briefId));
    await db.insert(runItems).values({
      runId,
      workspaceId,
      postTitle: brief.topic,
      status: 'failed',
      changesSummary: error,
      durationMs: Date.now() - startedAt,
    });
    await maybeFinalizeRun(db, runId);
    log(`falha: ${error}`);
  };

  try {
    // Enforcement de plano (Fase 5): posts/mês e tokens/mês, antes de gastar IA.
    try {
      await assertPlanAllowsGeneration(db, workspaceId);
    } catch (err) {
      if (err instanceof PlanLimitError) {
        await fail(err.message);
        return;
      }
      throw err;
    }

    await db.update(briefs).set({ status: 'generating', updatedAt: new Date() }).where(eq(briefs.id, briefId));

    const [site] = await db.select().from(sites).where(eq(sites.id, brief.siteId)).limit(1);
    if (!site) throw new Error('site da pauta não existe');

    // O modelo vem do perfil configurado pelo admin; do JSONB da pauta só
    // aproveitamos o orçamento de tokens.
    const llmConfig = jobLlmConfigSchema.parse(brief.llmConfig ?? {});
    const tokenBudget = llmConfig.tokenBudget ?? 500_000;
    const checkBudget = makeBudgetGuard(db, runId, tokenBudget);
    const [generateModel, verifyModel] = await Promise.all([
      resolveTaskModel(db, workspaceId, 'generate'),
      resolveTaskModel(db, workspaceId, 'verify'),
    ]);
    const [wp, template, search, llmGenerate, llmVerify] = await Promise.all([
      resolveWordPressAdapter(db, site),
      resolveTemplateById(db, brief.templateId, workspaceId),
      resolveSearchClient(db, workspaceId),
      resolveLlmProvider(db, workspaceId, generateModel),
      resolveLlmProvider(db, workspaceId, verifyModel),
    ]);

    // Anti-repetição: se o tema já foi coberto (posts do WP ou outra pauta que
    // gerou/está gerando conteúdo), não gera de novo — antes de gastar busca + IA.
    const [wpTitles, workspaceBriefs] = await Promise.all([
      wp.listRecentPostTitles(150).catch((err) => {
        log(`listRecentPostTitles falhou (guard segue só com pautas): ${err}`);
        return [] as Awaited<ReturnType<typeof wp.listRecentPostTitles>>;
      }),
      db
        .select({ id: briefs.id, topic: briefs.topic, status: briefs.status })
        .from(briefs)
        .where(eq(briefs.workspaceId, workspaceId)),
    ]);
    const existingTitles = [
      ...wpTitles.map((p) => p.title),
      ...workspaceBriefs
        .filter((b) => b.id !== briefId && ['generating', 'ready_for_review', 'published'].includes(b.status))
        .map((b) => b.topic),
    ].filter(Boolean);
    const guard = await checkTopicAlreadyCovered(
      { topic: brief.topic, existingTitles, language: brief.language },
      { llm: llmVerify, checkBudget, log },
    );
    if (guard.llmCalls.length > 0) await recordLlmCalls(db, workspaceId, runId, null, guard.llmCalls);
    if (guard.covered) {
      await fail(
        `Tema já coberto por conteúdo existente${guard.matchedTitle ? `: "${guard.matchedTitle}"` : ''} — geração pulada para evitar post repetido.`,
      );
      return;
    }

    // Categorias reais do site — só quando o template pede que o LLM escolha (Fase 2).
    const siteCategories = template.config.seo.chooseCategory
      ? await wp.listCategories().catch((err) => {
          log(`listCategories falhou: ${err}`);
          return [] as Awaited<ReturnType<typeof wp.listCategories>>;
        })
      : [];

    const keywords = brief.keywords?.length ? `Palavras-chave alvo: ${brief.keywords.join(', ')}.` : '';
    const extra = [keywords, brief.extraInstructions ?? ''].filter(Boolean).join('\n');

    const result = await runPipeline(
      {
        mode: 'generate',
        profile: 'full', // geração de conteúdo novo usa o fluxo completo (com verificação)
        template: template.config,
        language: brief.language,
        siteName: site.name,
        siteBaseUrl: site.baseUrl,
        availableCategories: siteCategories.map((c) => c.name),
        topicOverride: brief.topic,
        extraInstructions: extra,
        post: {
          title: brief.topic,
          slug: slugify(brief.topic),
        },
      },
      {
        llmGenerate,
        llmVerify,
        search,
        checkBudget,
        log,
      },
    );

    if (result.status !== 'ready' || !result.finalHtml) {
      const reason =
        result.validationErrors.length > 0
          ? `validação: ${result.validationErrors.join('; ')}`
          : result.skipReason ?? `pipeline retornou ${result.status}`;
      // registra métricas mesmo em falha
      const [item] = await db
        .insert(runItems)
        .values({
          runId,
          workspaceId,
          postTitle: brief.topic,
          status: result.status === 'validation_failed' ? 'validation_failed' : 'llm_failed',
          changesSummary: reason,
          extractedData: result.data,
          rejectedData: result.rejected,
          droppedData: result.dropped,
          validationErrors: result.validationErrors.length ? result.validationErrors : null,
          sources: result.sources,
          durationMs: Date.now() - startedAt,
        })
        .returning({ id: runItems.id });
      await recordLlmCalls(db, workspaceId, runId, item!.id, result.llmCalls);
      await db
        .update(briefs)
        .set({ status: 'failed', error: reason, updatedAt: new Date() })
        .where(eq(briefs.id, briefId));
      await maybeFinalizeRun(db, runId);
      return;
    }

    // Categoria escolhida pelo LLM (nome já validado contra as reais) → ID do WP.
    // Cai na categoria-alvo da pauta se o LLM não escolheu ou não bateu.
    const chosenCategoryId = result.category
      ? siteCategories.find((c) => c.name.toLowerCase() === result.category!.toLowerCase())?.id
      : undefined;
    const categoryId = chosenCategoryId ?? brief.targetCategoryWpId ?? undefined;

    // Imagens (Fase 3): capa + imagens do corpo, só quando o template pede.
    // A visão tem modelo PRÓPRIO no perfil (purpose `illustrate`): antes ela
    // reusava o de geração, então trocar aquele para um modelo sem visão
    // fazia todo post sair sem capa, em silêncio.
    let featuredMediaId: number | undefined;
    let finalHtml = result.finalHtml;
    if (template.config.images.enabled) {
      const inlineCount = suggestedInlineCount(finalHtml, template.config.images.inlineMax);
      const illustrateModel = await resolveTaskModel(db, workspaceId, 'illustrate');
      const llmVision = await resolveLlmProvider(db, workspaceId, illustrateModel);
      const { mediaId, inlineImages, llmCalls } = await illustratePost({
        wp,
        llmVision,
        topic: brief.topic,
        keywords: brief.keywords ?? [],
        language: brief.language,
        candidates: template.config.images.candidates,
        inlineCount,
        search,
        webSearch: template.config.images.webSearch,
        checkBudget,
        log,
      });
      featuredMediaId = mediaId ?? undefined;
      if (inlineImages.length > 0) finalHtml = injectInlineImages(finalHtml, inlineImages);
      result.llmCalls.push(...llmCalls); // registra os tokens da visão no run
    }

    const created = await wp.createPost({
      title: result.newTitle ?? brief.topic,
      content: finalHtml,
      status: brief.publishMode,
      categories: categoryId ? [categoryId] : undefined,
      featuredMediaId,
      // meta description SEO como excerpt do WP; cai no resumo de mudanças.
      excerpt: result.metaDescription || result.changesSummary || undefined,
    });

    const [item] = await db
      .insert(runItems)
      .values({
        runId,
        workspaceId,
        wpPostId: created.id,
        postTitle: result.newTitle ?? brief.topic,
        status: 'created',
        action: 'generate',
        changesSummary: result.changesSummary,
        extractedData: result.data,
        rejectedData: result.rejected,
        droppedData: result.dropped,
        sources: result.sources,
        sourcesHash: result.sourcesHash,
        durationMs: Date.now() - startedAt,
      })
      .returning({ id: runItems.id });
    await recordLlmCalls(db, workspaceId, runId, item!.id, result.llmCalls);

    await db
      .update(briefs)
      .set({
        status: brief.publishMode === 'publish' ? 'published' : 'ready_for_review',
        createdWpPostId: created.id,
        createdWpPostUrl: created.link,
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(briefs.id, briefId));

    await maybeFinalizeRun(db, runId);
    log(`post #${created.id} criado (${brief.publishMode}) em ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  } catch (err) {
    await fail(err instanceof Error ? err.message : String(err));
  } finally {
    await logger.flush();
  }
}
