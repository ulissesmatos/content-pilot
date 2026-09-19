import { sql } from 'drizzle-orm';
import { AnyPgColumn, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

/**
 * `role` é o cargo de plataforma gravado no banco. O SUPER ADMIN não vive
 * aqui: ele é derivado do ADMIN_EMAIL do .env (ver apps/web/src/lib/super-admin.ts),
 * justamente para não poder ser rebaixado por ninguém pelo painel.
 *
 * Exclusão é lógica (`deletedAt`): o histórico de runs/custos aponta para o
 * usuário e a auditoria precisa do rastro. Por isso o e-mail é único apenas
 * entre os NÃO excluídos — senão excluir uma conta queimaria aquele e-mail
 * para sempre.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name'),
    /**
     * owner = dono de workspace (cliente SaaS); admin = operador da plataforma
     * (gerencia credenciais globais e dá suporte). Isenção de cobrança NÃO vem
     * daqui — vem de workspaces.billingBypass.
     */
    role: text('role', { enum: ['owner', 'admin'] }).notNull().default('owner'),
    /** suspended = bloqueio temporário (inadimplência, abuso); banned = definitivo. */
    status: text('status', { enum: ['active', 'suspended', 'banned'] })
      .notNull()
      .default('active'),
    /** Motivo mostrado ao operador na auditoria — nunca ao usuário final. */
    statusReason: text('status_reason'),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    /**
     * Confirmação de e-mail. É informativa, não um portão: a conta funciona
     * sem confirmar. Serve para saber se a recuperação de senha tem para onde
     * ir antes de o usuário precisar dela.
     */
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    /**
     * Sessões emitidas ANTES deste instante não valem mais.
     *
     * O next-auth usa JWT: não há tabela de sessões para apagar. Sem este
     * carimbo, trocar a senha deixaria a sessão de quem roubou a conta viva
     * até o token expirar — exatamente a sessão que a troca queria derrubar.
     */
    sessionsValidFrom: timestamp('sessions_valid_from', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_email_active_idx').on(t.email).where(sql`deleted_at is null`),
    index('users_status_idx').on(t.status, t.deletedAt),
    index('users_workspace_idx').on(t.workspaceId),
  ],
);
