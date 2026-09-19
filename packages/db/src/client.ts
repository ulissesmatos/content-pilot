import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

/** Handle de transação: mesma API do Db, dentro de db.transaction(). */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function createDb(connectionString?: string): Db {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não definida');
  const pool = new Pool({ connectionString: url, max: 10 });
  return drizzle(pool, { schema });
}

// Singleton que sobrevive ao HMR do Next em dev
const globalForDb = globalThis as unknown as { __contentPilotDb?: Db };

export function getDb(): Db {
  if (!globalForDb.__contentPilotDb) {
    globalForDb.__contentPilotDb = createDb();
  }
  return globalForDb.__contentPilotDb;
}

/**
 * Tenant queries always run under a restricted PostgreSQL role, even when
 * DATABASE_URL belongs to the database owner. SET LOCAL cannot leak between
 * pooled connections. Never derive workspaceId from request input.
 * Each statement commits before returning (important for queue consumers).
 */
export function createTenantDb(db: Db, workspaceId: string): Db {
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(workspaceId)) {
    throw new Error('Workspace inválido.');
  }
  const scope = async (tx: Tx) => {
    await tx.execute(sql`set local role content_pilot_tenant`);
    await tx.execute(sql`select set_config('app.workspace_id', ${workspaceId}, true)`);
  };
  // Drizzle's node-postgres driver accepts a query-capable client. Preserve
  // query config (rowMode/type parsers) instead of reconstructing SQL/results.
  const pool = (db as Db & { $client: Pool }).$client;
  const client = {
    async query(config: string | import('pg').QueryConfig, values?: unknown[]) {
      const connection = await pool.connect();
      let failed = false;
      try {
        await connection.query('BEGIN');
        await connection.query('SET LOCAL ROLE content_pilot_tenant');
        await connection.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
        const result = await connection.query(config, values);
        await connection.query('COMMIT');
        return result;
      } catch (error) {
        try { await connection.query('ROLLBACK'); } catch { failed = true; }
        throw error;
      } finally {
        connection.release(failed);
      }
    },
  };
  const scoped = drizzle(client as unknown as Pool, { schema });
  scoped.transaction = (callback, config) => db.transaction(async (tx) => {
    await scope(tx);
    return callback(tx);
  }, config);
  return scoped;
}

export function getTenantDb(workspaceId: string): Db {
  return createTenantDb(getDb(), workspaceId);
}
