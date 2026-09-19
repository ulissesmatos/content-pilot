import 'server-only';
import { getDb, sql } from '@content-pilot/db';

/** Worker saudável = scheduler.tick concluído nos últimos 3 minutos. */
export async function isWorkerAlive(): Promise<boolean | null> {
  try {
    const result = await getDb().execute(
      sql`select max(completed_on) as last from pgboss.job where name = 'scheduler.tick' and state = 'completed'`,
    );
    const last = (result.rows?.[0] as { last: string | Date | null } | undefined)?.last;
    if (!last) return false;
    return Date.now() - new Date(last).getTime() < 3 * 60 * 1000;
  } catch {
    return null; // schema pgboss ainda não existe (worker nunca rodou)
  }
}

