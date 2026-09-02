import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
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
