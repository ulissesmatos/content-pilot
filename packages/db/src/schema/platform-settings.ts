import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Configuração NÃO-SECRETA da plataforma, editável pelo painel admin.
 *
 * Segredo nenhum entra aqui: chave de API e webhook secret vivem na tabela
 * `credentials` (cifrados pelo vault). Esta tabela guarda o que pode ser lido
 * em texto claro — quais modelos usar, dias de trial, flags de rollout.
 *
 * A chave reservada `__version` guarda um carimbo que muda a cada mutação
 * administrativa. O worker é um processo longevo e não pode reler config a
 * cada job: ele cacheia por 30s e, ao expirar, compara só este carimbo — uma
 * consulta barata — em vez de recarregar tudo.
 */
export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull().default({}),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
