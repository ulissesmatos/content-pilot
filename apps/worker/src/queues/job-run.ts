import { assertWorkerWorkspace } from '../lib/tenant';
import { contentJobs, eq, runs, sites, type Db } from '@content-pilot/db';
import { PlanLimitError, postFilterSchema, jobLimitsSchema } from '@content-pilot/core';
import type { PgBoss } from 'pg-boss';
import { resolveWordPressAdapter } from '../lib/resolve';
import { assertPlanAllowsLlmUsage } from '../lib/plan-guard';
import { createRunLogger } from '../lib/run-logger';
import { QUEUE, type JobRunPayload } from './names';

/**
 * job.run: lista os posts do WordPress conforme o filtro do job, grava
 * expected_items no run e faz fan-out de post.process (1 por post).
 */
export async function handleJobRun(db: Db, boss: PgBoss, payload: JobRunPayload) {
  const { jobId, runId } = payload;

  // Run cancelado antes de começar → aborta
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run || run.status !== 'running') {
    console.log(`[job.run] run ${runId} não está em execução — abortando`);
    return;
  }

  const [job] = await db.select().from(contentJobs).where(eq(contentJobs.id, jobId)).limit(1);
  if (!job) throw new Error(`content_job ${jobId} não existe`);
  if (run.jobId !== jobId || run.workspaceId !== job.workspaceId) throw new Error('Queue ownership mismatch');
  await assertWorkerWorkspace(db, run.workspaceId);
  const [site] = await db.select().from(sites).where(eq(sites.id, job.siteId)).limit(1);
  if (!site || site.workspaceId !== job.workspaceId) throw new Error(`site do job ${job.name} não existe`);
  const logger = createRunLogger(db, runId, `[job.run]`);
  const log = logger.log;

  try {
    // Teto de tokens do plano (Fase 5) — barra o ciclo inteiro antes de listar posts.
    try {
      await assertPlanAllowsLlmUsage(db, job.workspaceId);
    } catch (err) {
      if (err instanceof PlanLimitError) {
        log(`${job.name}: ciclo cancelado — ${err.message}`);
        await db
          .update(runs)
          .set({ status: 'cancelled', finishedAt: new Date(), error: err.message })
          .where(eq(runs.id, runId));
        return;
      }
      throw err;
    }

    const filter = postFilterSchema.parse(job.postFilter ?? {});
    const limits = jobLimitsSchema.parse(job.limits ?? {});

    let posts;
    try {
      const wp = await resolveWordPressAdapter(db, site);
      posts = await wp.listPosts({
        tags: filter.tags,
        categories: filter.categories,
        perPage: Math.min(filter.perPage, limits.maxPostsPerRun),
      });
    } catch (err) {
      const message = `falha ao listar posts do WordPress: ${err instanceof Error ? err.message : String(err)}`;
      log(`${job.name}: ${message}`);
      await db
        .update(runs)
        .set({ status: 'failed', finishedAt: new Date(), error: message })
        .where(eq(runs.id, runId));
      return;
    }

    await db.update(runs).set({ expectedItems: posts.length }).where(eq(runs.id, runId));

    if (posts.length === 0) {
      await db
        .update(runs)
        .set({ status: 'success', finishedAt: new Date(), stats: { updated: 0, no_change: 0 } })
        .where(eq(runs.id, runId));
      log(`${job.name}: nenhum post no filtro`);
      return;
    }

    for (const post of posts) {
      await boss.send(
        QUEUE.postProcess,
        { jobId, runId, wpPostId: post.id },
        { singletonKey: `${runId}:${post.id}`, retryLimit: 1, retryDelay: 120, expireInSeconds: 900 },
      );
    }
    log(`${job.name}: ${posts.length} post(s) do filtro enfileirados para processamento`);
  } finally {
    await logger.flush();
  }
}
