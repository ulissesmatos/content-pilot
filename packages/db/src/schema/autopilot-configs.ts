import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';
import { sites } from './sites';
import { contentTemplates } from './content-templates';

/**
 * Config do modo Autopilot (Fase 1): descoberta autônoma de temas + geração.
 * O scheduler varre (enabled, nextRunAt) junto com os content_jobs.
 * - seedTopics: nicho/temas-semente que guiam a busca de tendências
 * - discovery: { postsPerCycle, allowedTypes[], dedupeLookback, discoverTokenBudget }
 * - llmConfig: { discover, generate, verify } — descoberta barata + pipeline de geração
 * - autoQueue: true = pauta já entra na fila de geração; false = fica pendente p/ revisão
 */
export const autopilotConfigs = pgTable(
  'autopilot_configs',
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
    seedTopics: text('seed_topics').array().notNull().default([]),
    language: text('language').notNull().default('pt-BR'),
    scheduleCron: text('schedule_cron').notNull(),
    timezone: text('timezone').notNull().default('America/Sao_Paulo'),
    /** true = gera automaticamente; false = cria pauta pendente para revisão. */
    autoQueue: boolean('auto_queue').notNull().default(false),
    publishMode: text('publish_mode', { enum: ['draft', 'publish'] })
      .notNull()
      .default('draft'),
    discovery: jsonb('discovery').notNull(),
    llmConfig: jsonb('llm_config').notNull(),
    /**
     * Kill-switches da Fase 4: { monthlyBudgetUsd, maxPostsPerDay,
     * generationTokenBudget }. Validado por autopilotLimitsSchema no core.
     */
    limits: jsonb('limits').notNull().default({}),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('autopilot_configs_due_idx').on(t.enabled, t.nextRunAt)],
);
