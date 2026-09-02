import { bigserial, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { runs } from './runs';

/**
 * Log de execução persistido — as linhas que o worker antes só mandava para o
 * console (buscas, fontes, pré-checagem, ilustração, anti-repetição). Escrito
 * em lote pelo run-logger do worker; o detalhe da run exibe em quase tempo
 * real. Cai junto com o run (cascade).
 */
export const runLogs = pgTable(
  'run_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    /** Capturado no momento do log (não no flush) — ordem fiel dos passos. */
    ts: timestamp('ts', { withTimezone: true }).notNull(),
    line: text('line').notNull(),
  },
  (t) => [index('run_logs_run_ts_idx').on(t.runId, t.ts)],
);
