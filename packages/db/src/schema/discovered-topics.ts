import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';
import { autopilotConfigs } from './autopilot-configs';
import { runs } from './runs';
import { briefs } from './briefs';

/**
 * Feed de temas descobertos pelo Autopilot. Serve para (1) a UI mostrar o que
 * foi descoberto/descartado e (2) memória de dedup entre ciclos — evita
 * redescobrir e recriar o mesmo tema toda vez.
 * status: discovered (virou pauta) | discarded_duplicate | discarded_low_value
 */
export const discoveredTopics = pgTable(
  'discovered_topics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    autopilotConfigId: uuid('autopilot_config_id')
      .notNull()
      .references(() => autopilotConfigs.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').references(() => runs.id, { onDelete: 'set null' }),
    topic: text('topic').notNull(),
    contentType: text('content_type').notNull(),
    keywords: text('keywords').array().notNull().default([]),
    angle: text('angle'),
    suggestedTitle: text('suggested_title'),
    status: text('status', {
      enum: ['queued', 'pending', 'discarded_duplicate', 'discarded_low_value', 'dismissed'],
    }).notNull(),
    discardReason: text('discard_reason'),
    /** Pauta criada a partir deste tema (quando não descartado). */
    briefId: uuid('brief_id').references(() => briefs.id, { onDelete: 'set null' }),
    meta: jsonb('meta'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('discovered_topics_config_created_idx').on(t.autopilotConfigId, t.createdAt)],
);
