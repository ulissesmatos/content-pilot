import { CronExpressionParser } from 'cron-parser';
import { and, contentJobs, eq, lte, runs, sql, type Db } from '@content-pilot/db';
import type { PgBoss } from 'pg-boss';
import { QUEUE } from './names';

/** Calcula a próxima execução de um cron no timezone do job. */
export function nextRunAt(cron: string, timezone: string, from = new Date()): Date {
  const interval = CronExpressionParser.parse(cron, { currentDate: from, tz: timezone });
  return interval.next().toDate();
}

/**
 * Tick do scheduler (a cada minuto, singleton): varre jobs devidos, cria o
 * run, recalcula next_run_at e enfileira job.run. O estado vive no banco —
 * o pg-boss só carrega o tick fixo.
 */
export async function handleSchedulerTick(db: Db, boss: PgBoss) {
  const due = await db
    .select()
    .from(contentJobs)
    .where(and(eq(contentJobs.enabled, true), lte(contentJobs.nextRunAt, new Date())))
    .limit(20);

  for (const job of due) {
    const next = nextRunAt(job.scheduleCron, job.timezone);
    await db
      .update(contentJobs)
      .set({ nextRunAt: next, lastRunAt: new Date(), updatedAt: new Date() })
      .where(eq(contentJobs.id, job.id));

    const [run] = await db
      .insert(runs)
      .values({ workspaceId: job.workspaceId, jobId: job.id, trigger: 'cron', status: 'running' })
      .returning({ id: runs.id });

    const jobId = await boss.send(
      QUEUE.jobRun,
      { jobId: job.id, runId: run!.id },
      { singletonKey: job.id, retryLimit: 2, expireInSeconds: 300 },
    );
    if (!jobId) {
      // já existe um job.run pendente/ativo para este content_job — cancela o run recém-criado
      await db
        .update(runs)
        .set({ status: 'cancelled', finishedAt: new Date(), error: 'execução anterior ainda em andamento' })
        .where(eq(runs.id, run!.id));
      console.log(`[scheduler] job ${job.name}: execução anterior em andamento, pulando`);
    } else {
      console.log(`[scheduler] job ${job.name}: run ${run!.id} enfileirado (próximo: ${next.toISOString()})`);
    }
  }

  // higiene: expira entradas velhas do cache de fontes (best effort)
  await db.execute(sql`delete from source_cache where expires_at < now() - interval '2 days'`);
}
