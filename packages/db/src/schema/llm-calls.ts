import { index, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';
import { runs } from './runs';
import { runItems } from './run-items';

/** Métrica por chamada LLM — base do dashboard de custo. */
export const llmCalls = pgTable(
  'llm_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    runItemId: uuid('run_item_id').references(() => runItems.id, { onDelete: 'set null' }),
    purpose: text('purpose', { enum: ['generate', 'verify', 'discover', 'dedupe', 'illustrate'] }).notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costEstimateUsd: numeric('cost_estimate_usd', { precision: 10, scale: 6 }),
    durationMs: integer('duration_ms'),
    status: text('status', { enum: ['ok', 'error', 'truncated'] }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('llm_calls_workspace_created_idx').on(t.workspaceId, t.createdAt)],
);
