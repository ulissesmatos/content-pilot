import { assertWorkerWorkspace } from '../lib/tenant';
import { briefs, discoveredTopics, eq, resolveTaskModel, runItems, runs, sites, type Db } from '@content-pilot/db';
import {
  checkTopicAlreadyCovered,
  emptyImageReport,
  findEmbeds,
  injectAfterParagraphs,
  injectEmbeds,
  isNearDuplicate,
  isReviewEnabled,
  jobLlmConfigSchema,
  parseAngleNote,
  PlanLimitError,
  publicFetch,
  relevantTitlesFor,
  resolveEmbedPolicy,
  resolveStylePolicy,
  reviewArticle,
  runPipeline,
  slugify,
  stageMarker,
  suggestedInlineCount,
  type EditorialReport,
  type EmbedItem,
  type ImageHint,
  type ImageReport,
} from '@content-pilot/core';
import {
  preflightLlmTasks,
  resolveImageGenProvider,
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

  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run || run.status !== 'running') {
    console.log(`[brief ${briefId}] run não está em execução — abortando`);
    return;
  }

  const [brief] = await db.select().from(briefs).where(eq(briefs.id, briefId)).limit(1);
  if (!brief) throw new Error(`brief ${briefId} não existe`);
  if (run.briefId !== briefId || run.workspaceId !== brief.workspaceId) throw new Error('Queue ownership mismatch');
  await assertWorkerWorkspace(db, run.workspaceId);
  const workspaceId = brief.workspaceId;
  const logger = createRunLogger(db, runId, `[brief ${briefId}]`);
  const log = logger.log;

  await db.update(runs).set({ expectedItems: 1 }).where(eq(runs.id, runId));
  log(`geração da pauta "${brief.topic}" iniciada`);
  log(stageMarker('pesquisa'));

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
    if (!site || site.workspaceId !== brief.workspaceId) throw new Error('site da pauta não existe');

    // O modelo vem do perfil configurado pelo admin; do JSONB da pauta só
    // aproveitamos o orçamento de tokens.
    const llmConfig = jobLlmConfigSchema.parse(brief.llmConfig ?? {});
    const tokenBudget = llmConfig.tokenBudget ?? 500_000;
    const checkBudget = makeBudgetGuard(db, runId, tokenBudget);
    const [generateModel, verifyModel] = await Promise.all([
      resolveTaskModel(db, workspaceId, 'generate'),
      resolveTaskModel(db, workspaceId, 'verify'),
    ]);

    // Check-up de credenciais ANTES de gastar WP/busca/IA: confere que os
    // modelos configurados existem na conta do provedor (grátis).
    const preflightIssues = await preflightLlmTasks(db, workspaceId, [
      { ...generateModel, label: 'Geração' },
      { ...verifyModel, label: 'Verificação' },
    ]);
    if (preflightIssues.length > 0) {
      const reason = preflightIssues.join(' ');
      log(`check-up de credenciais falhou — nada gasto: ${reason}`);
      await fail(reason);
      return;
    }

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

    // Tema vindo da descoberta automática é um norte: o redator pode ajustar o enfoque e o título se
    // as fontes mostrarem que a sugestão é fraca. Tema digitado por uma pessoa mantém o assunto.
    const [discovered] = await db
      .select({ id: discoveredTopics.id })
      .from(discoveredTopics)
      .where(eq(discoveredTopics.briefId, briefId))
      .limit(1);
    const topicOrigin = discovered ? 'suggested' : 'requested';
    // ao mudar o enfoque o redator não pode cair em um assunto que o blog já cobriu
    const avoidTitles = relevantTitlesFor(
      [{ topic: brief.topic, contentType: 'evergreen', keywords: [], angle: '', suggestedTitle: brief.topic }],
      existingTitles,
      25,
    );

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
        topicOrigin,
        avoidTitles,
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

    // Revisão editorial: etapa SEPARADA da redação, com modelo próprio. Relê o
    // rascunho atrás de trecho maçante, seção curta e tom de IA, e diz onde uma
    // imagem ajudaria. A saída só entra se passar pelas guardas (link, número,
    // tamanho, estrutura); do contrário fica o texto original. Falha aqui nunca
    // derruba o post: é polimento.
    let reviewNotes: EditorialReport['review'] = null;
    let imageHints: ImageHint[] = [];
    let finalTitle = result.newTitle ?? brief.topic;
    let titleChange: EditorialReport['title'] = null;
    let reviewedHtml = result.finalHtml;
    if (isReviewEnabled(template.config)) {
      log(stageMarker('revisao'));
      try {
        const reviewModel = await resolveTaskModel(db, workspaceId, 'review');
        const llmReview = await resolveLlmProvider(db, workspaceId, reviewModel);
        const review = await reviewArticle(
          {
            topic: brief.topic,
            title: finalTitle,
            html: reviewedHtml,
            language: brief.language,
            context: result.searchContext,
            style: resolveStylePolicy(template.config),
            maxTokens: template.config.llmDefaults.generateMaxTokens,
            titleMin: template.config.validation.titleMin,
            titleMax: template.config.validation.titleMax,
          },
          { llm: llmReview, checkBudget, log },
        );
        result.llmCalls.push(...review.llmCalls);
        reviewedHtml = review.html;
        // o revisor viu o texto inteiro e pode ter achado um título que casa melhor com ele
        finalTitle = review.title;
        titleChange = review.titleChange;
        imageHints = review.imageHints;
        reviewNotes = {
          status: review.status,
          changes: review.changes,
          reason: review.reason,
          remainingTells: review.remainingTells,
        };
      } catch (err) {
        // etapa sem modelo configurado, chave sem acesso, etc.: segue sem revisão
        log(`revisão editorial indisponível, seguindo sem ela: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Imagens (Fase 3): capa + imagens do corpo, só quando o template pede.
    // A visão tem modelo PRÓPRIO no perfil (purpose `illustrate`): antes ela
    // reusava o de geração, então trocar aquele para um modelo sem visão
    // fazia todo post sair sem capa, em silêncio.
    let featuredMediaId: number | undefined;
    let finalHtml = reviewedHtml;
    let imageReport: ImageReport = emptyImageReport();
    // parágrafos que já têm imagem: o embed não cai neles
    let imageParagraphs: number[] = [];
    if (template.config.images.enabled) {
      log(stageMarker('imagens'));
      // O editor pode pedir mais imagens do que a proporção do texto sugere, até o teto do template.
      const inlineCount = Math.min(
        template.config.images.inlineMax,
        Math.max(suggestedInlineCount(finalHtml, template.config.images.inlineMax), imageHints.length),
      );
      const illustrateModel = await resolveTaskModel(db, workspaceId, 'illustrate');
      const illustrateIssues = await preflightLlmTasks(db, workspaceId, [
        { ...illustrateModel, label: 'Ilustração' },
      ]);
      if (illustrateIssues.length > 0) {
        // post sem capa é aceitável (fail-safe já existente); abortar o post
        // inteiro por causa da imagem, não.
        log(`check-up de credenciais falhou — post segue sem imagem: ${illustrateIssues.join(' ')}`);
      } else {
        const [llmVision, imageGen] = await Promise.all([
          resolveLlmProvider(db, workspaceId, illustrateModel),
          resolveImageGenProvider(db, workspaceId),
        ]);
        const ill = await illustratePost({
          wp,
          llmVision,
          topic: brief.topic,
          keywords: brief.keywords ?? [],
          language: brief.language,
          html: finalHtml,
          hints: imageHints,
          candidates: template.config.images.candidates,
          inlineCount,
          coverSize: template.config.images.cover,
          inlineSize: template.config.images.inline,
          format: template.config.images.format,
          quality: template.config.images.quality,
          // a imagem de destaque das próprias fontes do artigo é a mais relevante que existe
          sourceUrls: result.sources.map((s) => s.url),
          useSourceImages: template.config.images.sourceImages,
          search,
          webSearch: template.config.images.webSearch,
          imageGen: imageGen ?? undefined,
          checkBudget,
          log,
        });
        featuredMediaId = ill.mediaId ?? undefined;
        // cada imagem volta ao parágrafo do PRÓPRIO slot: se uma falhou, as outras não deslizam
        finalHtml = injectAfterParagraphs(finalHtml, ill.inline);
        imageParagraphs = ill.inline.map((i) => i.afterParagraph);
        result.llmCalls.push(...ill.llmCalls); // registra os tokens da visão no run
        imageReport = ill.report;
      }
    }

    // Embeds: vídeo do YouTube e tweets. Cada candidato vem de busca real e tem a
    // existência confirmada pelo oEmbed da plataforma; o modelo só escolhe entre
    // os verificados e nunca escreve URL. Falha aqui nunca derruba o post.
    let embedItems: EmbedItem[] = [];
    let embedNotes: string[] = [];
    const embedPolicy = resolveEmbedPolicy(template.config);
    if (embedPolicy.video || embedPolicy.maxTweets > 0) {
      log(stageMarker('embeds'));
      try {
        const found = await findEmbeds(
          {
            topic: brief.topic,
            language: brief.language,
            keywords: brief.keywords ?? [],
            wantVideo: embedPolicy.video,
            maxTweets: embedPolicy.maxTweets,
          },
          { search, llm: llmVerify, fetchImpl: publicFetch, checkBudget, log },
        );
        result.llmCalls.push(...found.llmCalls);
        embedItems = found.embeds;
        embedNotes = found.notes;
        finalHtml = injectEmbeds(finalHtml, found.embeds, { avoidParagraphs: imageParagraphs });
        if (found.embeds.length > 0) log(`embeds incorporados: ${found.embeds.map((e) => e.kind).join(', ')}`);
      } catch (err) {
        log(`embeds indisponíveis, seguindo sem eles: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Capa é obrigatória. Sem ela o post NUNCA sai publicado, nem no modo automático:
    // vira rascunho com o motivo no log, e a tela de preview oferece gerar a capa.
    const coverMissing = template.config.images.enabled && !featuredMediaId;
    const publishMode = coverMissing ? 'draft' : brief.publishMode;
    if (coverMissing && brief.publishMode === 'publish') {
      log('post NÃO publicado: nenhuma capa foi obtida. Criado como rascunho para você resolver a capa.');
    }

    // Se o redator ajustou o enfoque em relação ao tema sugerido, o porquê fica no relatório.
    const angle = parseAngleNote(result.changesSummary);
    if (angle) log(`enfoque ajustado pelo redator: ${angle}`);
    // O anti-repetição olhou o tema sugerido; um enfoque ajustado pode ter caído em assunto já coberto.
    const nearDuplicate = isNearDuplicate(finalTitle, existingTitles);
    if (nearDuplicate) log(`atenção: o título final é muito parecido com um post existente: "${nearDuplicate}"`);

    log(stageMarker('publicacao'));
    const created = await wp.createPost({
      title: finalTitle,
      content: finalHtml,
      status: publishMode,
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
        postTitle: finalTitle,
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
        status: publishMode === 'publish' ? 'published' : 'ready_for_review',
        createdWpPostId: created.id,
        createdWpPostUrl: created.link,
        imageReport,
        editorialReport: { review: reviewNotes, embeds: embedItems, embedNotes, title: titleChange, angle } satisfies EditorialReport,
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(briefs.id, briefId));

    await maybeFinalizeRun(db, runId);
    log(`post #${created.id} criado (${publishMode}) em ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  } catch (err) {
    await fail(err instanceof Error ? err.message : String(err));
  } finally {
    await logger.flush();
  }
}
