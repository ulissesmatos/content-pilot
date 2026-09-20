import { config } from 'dotenv';
import { resolve } from 'node:path';
import { PgBoss } from 'pg-boss';
import { count, createDb, modelCatalog } from '@content-pilot/db';
import {
  QUEUE,
  type AutopilotDiscoverPayload,
  type BriefGeneratePayload,
  type JobRunPayload,
  type PostProcessPayload,
} from './queues/names';
import { handleSchedulerTick } from './queues/scheduler-tick';
import { handleJobRun } from './queues/job-run';
import { handlePostProcess } from './queues/post-process';
import { handleBriefGenerate } from './queues/brief-generate';
import { handleAutopilotDiscover } from './queues/autopilot-discover';
import { handleCatalogSync } from './queues/catalog-sync';
import { startHealthServer } from './health-server';

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

  await boss.work(QUEUE.autopilotDiscover, async (jobs: Array<{ data: AutopilotDiscoverPayload }>) => {
    for (const job of jobs) await handleAutopilotDiscover(db, boss, job.data);
  });

  // Catálogo de modelos: de madrugada, e sob demanda pelo painel. Alimenta a
  // lista de escolha do admin e a tabela de preços usada no custo por chamada.
  await boss.schedule(QUEUE.catalogSync, '0 3 * * *');
  await boss.work(QUEUE.catalogSync, async () => {
    await handleCatalogSync(db);
  });

  // Catálogo vazio = instalação nova. Sem isto o admin abre /admin/ai/profiles
  // e não tem nenhum modelo para escolher até as 3h da manhã — o seletor fica
  // inútil justamente no momento em que ele está configurando o produto.
  // O endpoint de listagem do OpenRouter é público, então funciona sem chave.
  try {
    const [row] = await db.select({ total: count() }).from(modelCatalog);
    if (Number(row?.total ?? 0) === 0) {
      console.log('[worker] catálogo de modelos vazio — sincronizando agora');
      await boss.send(QUEUE.catalogSync, {});
    }
  } catch (err) {
    // nunca impede o worker de subir: sem catálogo o produto ainda roda
    console.error('[worker] não foi possível checar o catálogo', err);
  }

  startHealthServer(db);

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
