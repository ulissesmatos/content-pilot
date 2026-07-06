import { config } from 'dotenv';
import { resolve } from 'node:path';
import { PgBoss } from 'pg-boss';

config({ path: resolve(process.cwd(), '../../.env') });

/**
 * Worker do Content Pilot: consome as filas do pg-boss (schema `pgboss` no
 * mesmo Postgres da aplicação). Handlers de fila são registrados por
 * milestone: scheduler-tick, job-run, post-process (M3) e brief-generate (M5).
 */
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL não definida');

  const boss = new PgBoss({ connectionString });
  boss.on('error', (err: Error) => console.error('[pg-boss]', err));

  await boss.start();
  console.log('[worker] pg-boss iniciado — aguardando registro de filas (M3)');

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
