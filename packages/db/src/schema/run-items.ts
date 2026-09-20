import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';
import { runs } from './runs';

/** Um post processado dentro de um run. É a trilha de auditoria anti-alucinação. */
export const runItems = pgTable(
  'run_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    wpPostId: integer('wp_post_id'),
    postTitle: text('post_title'),
    status: text('status', {
      enum: [
        'updated',
        'created',
        'no_change',
        'skipped_sources_unchanged',
        'validation_failed',
        'llm_failed',
        'wp_failed',
        'budget_exceeded',
        'failed',
      ],
    }).notNull(),
    action: text('action'),
    changesSummary: text('changes_summary'),
    extractedData: jsonb('extracted_data'),
    rejectedData: jsonb('rejected_data'),
    droppedData: jsonb('dropped_data'),
    validationErrors: jsonb('validation_errors'),
    sources: jsonb('sources'),
    /** Contexto factual reaproveitável em um retry sem nova pesquisa. */
    searchContext: text('search_context'),
    sourcesHash: text('sources_hash'),
    /** Resposta não publicada, usada para reparo/retry sem perder o trabalho. */
    draftText: text('draft_text'),
    previousContentBackup: text('previous_content_backup'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('run_items_run_idx').on(t.runId),
    index('run_items_post_history_idx').on(t.workspaceId, t.wpPostId, t.createdAt),
  ],
);
