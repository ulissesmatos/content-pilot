import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';
import { credentials } from './credentials';

export const sites = pgTable('sites', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  cmsType: text('cms_type').notNull().default('wordpress'),
  credentialId: uuid('credential_id').references(() => credentials.id),
  defaultLanguage: text('default_language').notNull().default('pt-BR'),
  status: text('status', { enum: ['active', 'error', 'disabled'] })
    .notNull()
    .default('active'),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
