import { integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';
import { contentJobs } from './content-jobs';

/**
 * Hash das fontes da última execução por (job, post). Se as fontes não
 * mudaram e o job tem skipIfSourcesUnchanged, o pipeline pula o post antes
 * de qualquer chamada LLM — a principal alavanca de economia.
 */
export const postSourceState = pgTable(
  'post_source_state',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    jobId: uuid('job_id')
      .notNull()
      .references(() => contentJobs.id),
    wpPostId: integer('wp_post_id').notNull(),
    lastSourcesHash: text('last_sources_hash').notNull(),
    lastProcessedAt: timestamp('last_processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.wpPostId] })],
);
