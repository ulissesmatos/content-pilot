import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

/**
 * Vault de credenciais. `ciphertext` guarda o payload JSON da credencial
 * criptografado com AES-256-GCM no formato `enc:v1:<keyId>:<iv>:<ct>:<tag>`.
 * `keyId` indica qual master key (env VAULT_MASTER_KEYS) criptografou a linha,
 * permitindo rotação. `maskedHint` são os últimos 4 chars capturados no save,
 * única parte exibida no painel.
 *
 * `workspaceId` NULL = credencial da PLATAFORMA: chaves da instalação
 * (Stripe, Resend e a reserva de IA/busca do proprietário). NÃO é fallback
 * para os demais workspaces — quem resolve isso é canUsePlatformKeys, e todo
 * o resto é BYOK. Só o super admin cria; o AAD do vault usa o escopo fixo
 * `platform` no lugar do workspaceId.
 */
export const credentials = pgTable(
  'credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    type: text('type', {
      enum: ['wordpress', 'anthropic', 'openai', 'openrouter', 'tavily', 'stripe', 'resend'],
    }).notNull(),
    name: text('name').notNull(),
    ciphertext: text('ciphertext').notNull(),
    keyId: text('key_id').notNull(),
    maskedHint: text('masked_hint'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('credentials_workspace_type_idx').on(t.workspaceId, t.type)],
);
