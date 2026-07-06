import { briefs, eq, runItems, runs, sites, type Db } from '@content-pilot/db';
import { jobLlmConfigSchema, runPipeline } from '@content-pilot/core';
import {
  resolveLlmProvider,
  resolveSearchClient,
  resolveTemplateById,
  resolveWordPressAdapter,
} from '../lib/resolve';
import { makeBudgetGuard, maybeFinalizeRun, recordLlmCalls } from '../lib/run-helpers';
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

  await db.update(runs).set({ expectedItems: 1 }).where(eq(runs.id, runId));

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
    console.error(`[brief ${briefId}] falha: ${error}`);
  };

  try {
    await db.update(briefs).set({ status: 'generating', updatedAt: new Date() }).where(eq(briefs.id, briefId));

    const [site] = await db.select().from(sites).where(eq(sites.id, brief.siteId)).limit(1);
    if (!site) throw new Error('site da pauta não existe');

    const llmConfig = jobLlmConfigSchema.parse(brief.llmConfig ?? {});
    const [wp, template, search, llmGenerate, llmVerify] = await Promise.all([
      resolveWordPressAdapter(db, site),
      resolveTemplateById(db, brief.templateId),
      resolveSearchClient(db, workspaceId),
      resolveLlmProvider(db, workspaceId, llmConfig.generate),
      resolveLlmProvider(db, workspaceId, llmConfig.verify),
    ]);

    const keywords = brief.keywords?.length ? `Palavras-chave alvo: ${brief.keywords.join(', ')}.` : '';
    const extra = [keywords, brief.extraInstructions ?? ''].filter(Boolean).join('\n');

    const result = await runPipeline(
      {
        mode: 'generate',
        profile: 'full', // geração de conteúdo novo usa o fluxo completo (com verificação)
        template: template.config,
        language: brief.language,
        siteName: site.name,
        topicOverride: brief.topic,
        extraInstructions: extra,
        post: {
          title: brief.topic,
          slug: brief.topic
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, ''),
        },
      },
      {
        llmGenerate,
        llmVerify,
        search,
        checkBudget: makeBudgetGuard(db, runId, 500_000),
        log: (msg) => console.log(`[brief ${briefId}] ${msg}`),
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

    const created = await wp.createPost({
      title: result.newTitle ?? brief.topic,
      content: result.finalHtml,
      status: brief.publishMode,
      categories: brief.targetCategoryWpId ? [brief.targetCategoryWpId] : undefined,
      excerpt: result.changesSummary ?? undefined,
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
    console.log(
      `[brief ${briefId}] post #${created.id} criado (${brief.publishMode}) em ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
    );
  } catch (err) {
    await fail(err instanceof Error ? err.message : String(err));
  }
}
