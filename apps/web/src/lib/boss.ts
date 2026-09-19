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

/** Queue tables are platform-owned; recheck ownership inside this privileged query. */
export async function pendingRunJobs(workspaceId: string, runId: string) {
  const { getDb, sql } = await import('@content-pilot/db');
  const result = await getDb().execute(sql`
    select j.id::text as id, j.name from pgboss.job j
    inner join public.runs r on r.id::text = j.data ->> 'runId'
    where r.workspace_id = ${workspaceId}::uuid and r.id = ${runId}::uuid
      and j.state in ('created', 'retry')
      and j.name in ('job.run', 'post.process', 'brief.generate', 'autopilot.discover')
  `);
  return result.rows as Array<{ id: string; name: string }>;
}
