import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';
import { sites } from './sites';
import { contentTemplates } from './content-templates';

/**
 * Job recorrente de atualização de posts.
 * - postFilter: { tags?: number[], categories?: number[], perPage?: number, statuses?: string[] }
 * - llmConfig:  { generate: {provider, model, credentialId, maxTokens},
 *                 verify:   {provider, model, credentialId, maxTokens} }
 * - limits:     { maxPostsPerRun, tokenBudgetPerRun, skipIfSourcesUnchanged }
 * O scheduler varre (enabled, nextRunAt) a cada minuto.
 */
export const contentJobs = pgTable(
  'content_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id),
    templateId: uuid('template_id')
      .notNull()
      .references(() => contentTemplates.id),
    name: text('name').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    postFilter: jsonb('post_filter').notNull(),
    scheduleCron: text('schedule_cron').notNull(),
    timezone: text('timezone').notNull().default('America/Sao_Paulo'),
    language: text('language'),
    llmConfig: jsonb('llm_config').notNull(),
    limits: jsonb('limits').notNull(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('content_jobs_due_idx').on(t.enabled, t.nextRunAt)],
);
