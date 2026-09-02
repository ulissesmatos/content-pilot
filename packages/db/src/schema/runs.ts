import { AnyPgColumn, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';
import { contentJobs } from './content-jobs';
import { briefs } from './briefs';
import { autopilotConfigs } from './autopilot-configs';

/**
 * Uma execução — de um job cron, disparo manual, geração de pauta ou
 * descoberta do Autopilot.
 * stats: contagens por status de run_item + { tokensIn, tokensOut, costEstimateUsd }
 * (descoberta grava { discovered, queued, pending, discarded, sources, ... }).
 *
 * As FKs de origem são SET NULL: excluir a pauta/job/autopilot preserva o
 * histórico de execuções (e a contagem de uso do plano) com origem órfã.
 * `kind` é gravado na criação — a origem pode sumir, o tipo não.
 */
export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    jobId: uuid('job_id').references(() => contentJobs.id, { onDelete: 'set null' }),
    briefId: uuid('brief_id').references(() => briefs.id, { onDelete: 'set null' }),
    /** Preenchido em descobertas E nas gerações disparadas pelo Autopilot (atribuição de custo). FK atrasada p/ evitar ciclo de import. */
    autopilotConfigId: uuid('autopilot_config_id').references((): AnyPgColumn => autopilotConfigs.id, {
      onDelete: 'set null',
    }),
    /** O que este run faz — independe das FKs de origem (que podem virar NULL). */
    kind: text('kind', { enum: ['update', 'create', 'discover'] })
      .notNull()
      .default('update'),
    trigger: text('trigger', { enum: ['cron', 'manual', 'autopilot'] }).notNull(),
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
