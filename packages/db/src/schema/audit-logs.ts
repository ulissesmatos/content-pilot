import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';
import { workspaces } from './workspaces';

/**
 * Trilha de auditoria de TODA mutação feita pelo painel admin — ações de um
 * operador sobre dados de terceiros precisam de rastro.
 *
 * `actorEmail` e `actorRole` são snapshot no momento da ação: sobrevivem à
 * exclusão do ator e ao rebaixamento de cargo, que é justamente quando o
 * registro mais importa. `actorRole` carrega 'super_admin' mesmo esse valor
 * não existindo em users.role, porque super-adminidade é derivada do
 * ADMIN_EMAIL e nunca armazenada.
 *
 * `diff` já chega redigido pelo runAdminAction: segredo vira máscara, nunca
 * texto claro.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorEmail: text('actor_email').notNull(),
    actorRole: text('actor_role', { enum: ['owner', 'admin', 'super_admin'] }).notNull(),
    /** Verbo pontilhado: 'user.suspend', 'plan.update', 'settings.stripe.rotate'. */
    action: text('action').notNull(),
    targetType: text('target_type', {
      enum: ['user', 'workspace', 'plan', 'subscription', 'credential', 'settings', 'model_profile'],
    }).notNull(),
    /** text (não uuid): alvos como `settings` são identificados por chave. */
    targetId: text('target_id'),
    /** Tenant afetado, quando a ação tem um. */
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    /** { before, after } — sempre redigido. */
    diff: jsonb('diff'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_created_idx').on(t.createdAt),
    index('audit_logs_target_idx').on(t.targetType, t.targetId),
    index('audit_logs_actor_idx').on(t.actorUserId, t.createdAt),
  ],
);
