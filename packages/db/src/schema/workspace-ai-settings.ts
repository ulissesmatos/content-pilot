import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

/**
 * Preferência de IA do workspace — só tem efeito para quem traz a própria
 * chave (BYOK). Quem não traz chave usa sempre o perfil do admin
 * (model_profiles): é o que mantém o custo por post previsível nos planos.
 *
 * `provider`/`model` é a escolha explícita do cliente (alimentada pelo select
 * que lê os modelos disponíveis na própria API key). Fica vazio até o cliente
 * escolher — nesse caso o worker cai no fallback automático: usa a primeira
 * credencial de IA que o workspace tiver, com um modelo padrão razoável (ver
 * `resolveWorkspaceLlmOverride`).
 *
 * `imageGenModel` liga a geração de imagem via OpenAI como último recurso do
 * `illustrate` (nenhuma imagem da web/acervo passou na revisão de qualidade).
 * Exige credencial OpenAI própria mesmo que o texto use outro provedor —
 * nunca cai para a chave da plataforma.
 */
export const workspaceAiSettings = pgTable('workspace_ai_settings', {
  workspaceId: uuid('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  provider: text('provider', { enum: ['anthropic', 'openai', 'openrouter'] }),
  model: text('model'),
  imageGenModel: text('image_gen_model'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
