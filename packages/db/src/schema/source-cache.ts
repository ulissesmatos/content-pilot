import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

/** Cache do Tavily Extract por URL normalizada (TTL ~12h) — economiza créditos. */
export const sourceCache = pgTable(
  'source_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    urlNormalized: text('url_normalized').notNull(),
    title: text('title'),
    contentText: text('content_text'),
    contentHash: text('content_hash'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('source_cache_workspace_url_uq').on(t.workspaceId, t.urlNormalized)],
);
