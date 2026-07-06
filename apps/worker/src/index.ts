import { config } from 'dotenv';
import { resolve } from 'node:path';
import { PgBoss } from 'pg-boss';
import { createDb } from '@content-pilot/db';
import { QUEUE, type BriefGeneratePayload, type JobRunPayload, type PostProcessPayload } from './queues/names';
import { handleSchedulerTick } from './queues/scheduler-tick';
import { handleJobRun } from './queues/job-run';
import { handlePostProcess } from './queues/post-process';
import { handleBriefGenerate } from './queues/brief-generate';

config({ path: resolve(process.cwd(), '../../.env') });

/**
 * Worker do Content Pilot: consome as filas do pg-boss (schema `pgboss` no
 * mesmo Postgres da aplicação). O scheduler.tick roda a cada minuto e dirige
 * os agendamentos a partir de content_jobs (estado no banco, não na fila).
 */
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL não definida');
  const concurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 2));

  const db = createDb();
  const boss = new PgBoss({ connectionString });
  boss.on('error', (err: Error) => console.error('[pg-boss]', err));

  await boss.start();
  for (const queue of Object.values(QUEUE)) {
    await boss.createQueue(queue);
  }

  await boss.schedule(QUEUE.schedulerTick, '* * * * *');
  await boss.work(QUEUE.schedulerTick, async () => {
    await handleSchedulerTick(db, boss);
  });

  await boss.work(QUEUE.jobRun, async (jobs: Array<{ data: JobRunPayload }>) => {
    for (const job of jobs) await handleJobRun(db, boss, job.data);
  });

  await boss.work(
    QUEUE.postProcess,
    { batchSize: concurrency },
    async (jobs: Array<{ data: PostProcessPayload }>) => {
      await Promise.all(jobs.map((job) => handlePostProcess(db, job.data)));
    },
  );

  await boss.work(QUEUE.briefGenerate, async (jobs: Array<{ data: BriefGeneratePayload }>) => {
    for (const job of jobs) await handleBriefGenerate(db, job.data);
  });

  console.log(`[worker] pronto — filas registradas (concorrência post.process: ${concurrency})`);

  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal} recebido, encerrando...`);
    await boss.stop({ graceful: true });
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[worker] falha fatal:', err);
  process.exit(1);
});
