import { and, autopilotConfigs, contentJobs, eq, lte, runs, sql, type Db } from '@content-pilot/db';
import { nextRunAt } from '@content-pilot/core';
import type { PgBoss } from 'pg-boss';
import { QUEUE } from './names';

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
      .values({ workspaceId: job.workspaceId, jobId: job.id, kind: 'update', trigger: 'cron', status: 'running' })
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

  await tickAutopilot(db, boss);

  // higiene: expira entradas velhas do cache de fontes (best effort)
  await db.execute(sql`delete from source_cache where expires_at < now() - interval '2 days'`);
}

/** Varre configs de Autopilot devidas e enfileira a descoberta (mesmo padrão dos jobs). */
async function tickAutopilot(db: Db, boss: PgBoss) {
  const due = await db
    .select()
    .from(autopilotConfigs)
    .where(and(eq(autopilotConfigs.enabled, true), lte(autopilotConfigs.nextRunAt, new Date())))
    .limit(10);

  for (const cfg of due) {
    const next = nextRunAt(cfg.scheduleCron, cfg.timezone);
    await db
      .update(autopilotConfigs)
      .set({ nextRunAt: next, lastRunAt: new Date(), updatedAt: new Date() })
      .where(eq(autopilotConfigs.id, cfg.id));

    const [run] = await db
      .insert(runs)
      .values({ workspaceId: cfg.workspaceId, autopilotConfigId: cfg.id, kind: 'discover', trigger: 'cron', status: 'running' })
      .returning({ id: runs.id });

    const sent = await boss.send(
      QUEUE.autopilotDiscover,
      { autopilotConfigId: cfg.id, runId: run!.id },
      { singletonKey: cfg.id, retryLimit: 1, expireInSeconds: 600 },
    );
    if (!sent) {
      await db
        .update(runs)
        .set({ status: 'cancelled', finishedAt: new Date(), error: 'descoberta anterior ainda em andamento' })
        .where(eq(runs.id, run!.id));
      console.log(`[scheduler] autopilot ${cfg.name}: descoberta anterior em andamento, pulando`);
    } else {
      console.log(`[scheduler] autopilot ${cfg.name}: run ${run!.id} enfileirado (próximo: ${next.toISOString()})`);
    }
  }
}
