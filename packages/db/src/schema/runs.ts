import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';
import { contentJobs } from './content-jobs';
import { briefs } from './briefs';

/**
 * Uma execução — de um job cron, disparo manual ou geração de pauta.
 * stats: { updated, noChange, skipped, failed, tokensIn, tokensOut, costEstimateUsd }
 */
export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    jobId: uuid('job_id').references(() => contentJobs.id),
    briefId: uuid('brief_id').references(() => briefs.id),
    trigger: text('trigger', { enum: ['cron', 'manual'] }).notNull(),
    status: text('status', {
      enum: ['running', 'success', 'partial', 'failed', 'cancelled'],
    })
      .notNull()
      .default('running'),
    expectedItems: integer('expected_items'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    stats: jsonb('stats'),
    error: text('error'),
  },
  (t) => [index('runs_workspace_started_idx').on(t.workspaceId, t.startedAt)],
);
