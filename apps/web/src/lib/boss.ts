import 'server-only';
import { PgBoss } from 'pg-boss';

/** Cliente pg-boss do painel — usado apenas para enfileirar (Executar agora, pautas). */
const globalForBoss = globalThis as unknown as { __contentPilotBoss?: Promise<PgBoss> };

export function getBoss(): Promise<PgBoss> {
  if (!globalForBoss.__contentPilotBoss) {
    globalForBoss.__contentPilotBoss = (async () => {
      const boss = new PgBoss({ connectionString: process.env.DATABASE_URL! });
      boss.on('error', (err: Error) => console.error('[pg-boss:web]', err));
      await boss.start();
      return boss;
    })();
  }
  return globalForBoss.__contentPilotBoss;
}
