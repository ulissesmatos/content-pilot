import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';
import { sites } from './sites';
import { contentTemplates } from './content-templates';

/** Pauta para geração de post novo. */
export const briefs = pgTable('briefs', {
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
  topic: text('topic').notNull(),
  keywords: text('keywords').array().notNull().default([]),
  language: text('language').notNull().default('pt-BR'),
  targetCategoryWpId: integer('target_category_wp_id'),
  extraInstructions: text('extra_instructions'),
  publishMode: text('publish_mode', { enum: ['draft', 'publish'] })
    .notNull()
    .default('draft'),
  status: text('status', {
    enum: ['pending', 'queued', 'generating', 'ready_for_review', 'published', 'failed'],
  })
    .notNull()
    .default('pending'),
  createdWpPostId: integer('created_wp_post_id'),
  createdWpPostUrl: text('created_wp_post_url'),
  llmConfig: jsonb('llm_config'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
