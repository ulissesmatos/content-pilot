import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Tokens de uso único enviados por e-mail (troca de senha, confirmação).
 *
 * Guardamos o SHA-256 do token, nunca o valor: quem lê esta tabela — backup,
 * dump, log de consulta — não consegue assumir nenhuma conta. O segredo existe
 * só dentro do link que foi para a caixa de entrada.
 *
 * `usedAt` marca em vez de apagar para que a segunda tentativa com o mesmo
 * link seja distinguível de um link inventado, e para o rastro de suporte.
 */
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['password_reset', 'email_verify'] }).notNull(),
    /** SHA-256 hex do token que viajou no link. Único: colisão vira erro, não acesso. */
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    /** Só para auditoria de abuso; o rate limit real é a tabela rate_limits. */
    requestedIp: text('requested_ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('auth_tokens_user_type_idx').on(t.userId, t.type, t.usedAt)],
);
