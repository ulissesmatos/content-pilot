import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

/**
 * Preferência de IA do workspace — só tem efeito para quem traz a própria
 * chave (BYOK). Quem não traz chave usa sempre o perfil do admin
 * (model_profiles): é o que mantém o custo por post previsível nos planos.
 *
 * `provider`/`model` é a escolha explícita do cliente (alimentada pelo select
 * que lê os modelos disponíveis na própria API key). Fica vazio até o cliente
 * escolher — nesse caso o worker escolhe uma das chaves próprias numa ordem
 * fixa (OpenAI, Anthropic, OpenRouter), nunca troca para uma chave do sistema.
 *
 * `preferOwnKeys` é uma proteção explícita para o super admin. Ligado (o
 * padrão), as chaves BYOK dele vencem as chaves do sistema. Desligado, só ele
 * pode optar pelos perfis/chaves do sistema; se a chave do sistema escolhida
 * não existir, o worker volta ao BYOK em vez de cair em outro provedor.
 *
 * `imageGenModel` liga a geração de imagem via OpenAI como último recurso do
 * `illustrate` (nenhuma imagem da web/acervo passou na revisão de qualidade).
 * Exige uma credencial OpenAI própria; no modo de sistema, exclusivamente do
 * super admin e com a prioridade BYOK desligada, pode usar a chave OpenAI do
 * sistema.
 */
export const workspaceAiSettings = pgTable('workspace_ai_settings', {
  workspaceId: uuid('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  provider: text('provider', { enum: ['anthropic', 'openai', 'openrouter'] }),
  model: text('model'),
  preferOwnKeys: boolean('prefer_own_keys').notNull().default(true),
  imageGenModel: text('image_gen_model'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
