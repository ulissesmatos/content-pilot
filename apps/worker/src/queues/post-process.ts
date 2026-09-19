import { assertWorkerWorkspace } from '../lib/tenant';
import {
  and,
  contentJobs,
  eq,
  postSourceState,
  resolveTaskModel,
  runItems,
  runs,
  sites,
  type Db,
} from '@content-pilot/db';
import { jobLimitsSchema, runPipeline, type PipelineResult } from '@content-pilot/core';
import {
  resolveLlmProvider,
  resolveSearchClient,
  resolveTemplateById,
  resolveWordPressAdapter,
} from '../lib/resolve';
import { makeBudgetGuard, makeCachedExtract, maybeFinalizeRun, recordLlmCalls } from '../lib/run-helpers';
import { createRunLogger } from '../lib/run-logger';
import type { PostProcessPayload } from './names';

const STATUS_MAP: Record<PipelineResult['status'], string> = {
  ready: 'updated',
  no_change: 'no_change',
  skipped_sources_unchanged: 'skipped_sources_unchanged',
  validation_failed: 'validation_failed',
  llm_failed: 'llm_failed',
  budget_exceeded: 'budget_exceeded',
};

/** post.process: pipeline completo de 1 post + publicação + trilha de auditoria. */
export async function handlePostProcess(db: Db, payload: PostProcessPayload) {
  const { jobId, runId, wpPostId } = payload;
  const startedAt = Date.now();

  // Idempotência: retry após sucesso parcial vira no-op
  const [existing] = await db
    .select({ id: runItems.id })
    .from(runItems)
    .where(and(eq(runItems.runId, runId), eq(runItems.wpPostId, wpPostId)))
    .limit(1);
  if (existing) {
    await maybeFinalizeRun(db, runId);
    return;
  }

  // Run cancelado pelo usuário → não processa mais nada dele
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run || run.status !== 'running') {
    console.log(`[post ${wpPostId}] run ${runId} não está em execução (${run?.status ?? 'inexistente'}) — pulando`);
    return;
  }

  const [job] = await db.select().from(contentJobs).where(eq(contentJobs.id, jobId)).limit(1);
  if (!job) throw new Error(`content_job ${jobId} não existe`);
  if (run.jobId !== jobId || run.workspaceId !== job.workspaceId) throw new Error('Queue ownership mismatch');
  await assertWorkerWorkspace(db, run.workspaceId);
  const [site] = await db.select().from(sites).where(eq(sites.id, job.siteId)).limit(1);
  if (!site || site.workspaceId !== job.workspaceId) throw new Error(`site do job não existe`);
  const workspaceId = job.workspaceId;
  const logger = createRunLogger(db, runId, `[post ${wpPostId}]`);
  const log = logger.log;

  const record = async (
    status: string,
    result: Partial<PipelineResult> & { skipReason?: string | null },
    extras: { postTitle?: string; previousContentBackup?: string | null; error?: string } = {},
  ) => {
    const [item] = await db
      .insert(runItems)
      .values({
        runId,
        workspaceId,
        wpPostId,
        postTitle: extras.postTitle ?? null,
        status: status as never,
        action: result.action ?? null,
        changesSummary: extras.error ?? result.skipReason ?? result.changesSummary ?? null,
        extractedData: result.data ?? null,
        rejectedData: result.rejected ?? null,
        droppedData: result.dropped ?? null,
        validationErrors: result.validationErrors?.length ? result.validationErrors : null,
        sources: result.sources ?? null,
        sourcesHash: result.sourcesHash ?? null,
        previousContentBackup: extras.previousContentBackup ?? null,
        durationMs: Date.now() - startedAt,
      })
      .returning({ id: runItems.id });
    if (result.llmCalls?.length) {
      await recordLlmCalls(db, workspaceId, runId, item!.id, result.llmCalls);
    }
    await maybeFinalizeRun(db, runId);
  };

  try {
    const limits = jobLimitsSchema.parse(job.limits ?? {});
    // Modelo definido pelo admin (perfil), não pelo job.
    const [generateModel, verifyModel] = await Promise.all([
      resolveTaskModel(db, workspaceId, 'generate'),
      resolveTaskModel(db, workspaceId, 'verify'),
    ]);
    const [wp, template, search, llmGenerate, llmVerify] = await Promise.all([
      resolveWordPressAdapter(db, site),
      resolveTemplateById(db, job.templateId, workspaceId),
      resolveSearchClient(db, workspaceId),
      resolveLlmProvider(db, workspaceId, generateModel),
      resolveLlmProvider(db, workspaceId, verifyModel),
    ]);

    const post = await wp.getPost(wpPostId);

    // Estado da última execução: hash das fontes + dados publicados (pré-checagem eco)
    const [state] = await db
      .select({ hash: postSourceState.lastSourcesHash, lastData: postSourceState.lastExtractedData })
      .from(postSourceState)
      .where(and(eq(postSourceState.jobId, jobId), eq(postSourceState.wpPostId, wpPostId)))
      .limit(1);

    const result = await runPipeline(
      {
        mode: 'update',
        profile: limits.mode,
        searchDepth: limits.searchDepth === 'auto' ? undefined : limits.searchDepth,
        template: template.config,
        language: job.language ?? site.defaultLanguage,
        siteName: site.name,
        post: { id: post.id, title: post.title, slug: post.slug, contentRaw: post.contentRaw },
        lastData: (state?.lastData as Record<string, unknown> | null) ?? null,
      },
      {
        llmGenerate,
        llmVerify,
        search,
        extract: makeCachedExtract(db, workspaceId, search),
        checkBudget: makeBudgetGuard(db, runId, limits.tokenBudgetPerRun),
        shouldSkipSources: async (hash) => {
          if (!limits.skipIfSourcesUnchanged) return false;
          return state?.hash === hash;
        },
        log,
      },
    );

    let finalStatus = STATUS_MAP[result.status];
    let backup: string | null = null;
    let wpError: string | undefined;

    if (result.status === 'ready' && result.finalHtml) {
      backup = post.contentRaw;
      try {
        await wp.updatePost(wpPostId, {
          title: result.newTitle ?? post.title,
          content: result.finalHtml,
          status: 'publish',
        });
      } catch (err) {
        finalStatus = 'wp_failed';
        wpError = `falha ao publicar no WordPress: ${err instanceof Error ? err.message : String(err)}`;
        log(wpError);
      }
    }

    // Hash das fontes + dados publicados: registra quando o post foi efetivamente processado.
    // Os dados extraídos (base da pré-checagem eco) só são gravados em atualização real.
    if (result.sourcesHash && (finalStatus === 'updated' || finalStatus === 'no_change')) {
      const dataPatch =
        finalStatus === 'updated' && result.data && Object.keys(result.data).length > 0
          ? { lastExtractedData: result.data }
          : {};
      await db
        .insert(postSourceState)
        .values({
          workspaceId,
          jobId,
          wpPostId,
          lastSourcesHash: result.sourcesHash,
          lastExtractedData: finalStatus === 'updated' ? result.data : null,
          lastProcessedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [postSourceState.jobId, postSourceState.wpPostId],
          set: { lastSourcesHash: result.sourcesHash, lastProcessedAt: new Date(), ...dataPatch },
        });
    }

    await record(finalStatus, result, {
      postTitle: post.title,
      previousContentBackup: backup,
      error: wpError,
    });
    log(`${finalStatus} (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`falha: ${message}`);
    await record('failed', {}, { error: message });
  } finally {
    await logger.flush();
  }
}
