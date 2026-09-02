import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * O tenant. Não tem `deletedAt`: excluir uma empresa é um cascade real e
 * ordenado (ver actions/admin/workspaces), porque um workspace meio-excluído
 * vazaria em ~30 queries que filtram só por workspaceId.
 */
export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** suspended = o scheduler não dispara nada e o painel fica em leitura. */
  status: text('status', { enum: ['active', 'suspended'] })
    .notNull()
    .default('active'),
  /**
   * Isenção total de cobrança/quota, concedida explicitamente pelo super admin
   * (workspace interno, cliente de cortesia). NUNCA derivada do cargo de um
   * usuário — foi assim que a versão anterior deu uso ilimitado de graça a
   * qualquer workspace que tivesse um admin dentro.
   */
  billingBypass: boolean('billing_bypass').notNull().default(false),
  /** Anotações internas do operador (nunca exibidas ao cliente). */
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
