import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * Catálogo de modelos sincronizado dos provedores.
 *
 * Serve a dois propósitos que hoje não têm dono:
 *  1. o admin escolhe o modelo a partir de uma lista real, em vez de digitar
 *     um id e descobrir o erro só quando a execução falha;
 *  2. o preço por token vira dado, não constante de código. Hoje
 *     `packages/core/src/llm/pricing.ts` é uma tabela fixa que devolve null
 *     para modelo desconhecido — e null vira custo NULL no banco, deixando o
 *     gasto invisível justamente nos modelos novos.
 *
 * O OpenRouter é a fonte de preço: o endpoint público /models traz o valor
 * por token de centenas de modelos, inclusive dos que se acessa direto na
 * OpenAI/Anthropic (daí o `priceSource: 'openrouter_match'`).
 */
export const modelCatalog = pgTable(
  'model_catalog',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider', { enum: ['anthropic', 'openai', 'openrouter'] }).notNull(),
    /** Id usado na chamada: "z-ai/glm-5.2" no OpenRouter, "gpt-4o" na OpenAI. */
    modelId: text('model_id').notNull(),
    displayName: text('display_name').notNull(),
    contextLength: integer('context_length'),
    maxOutputTokens: integer('max_output_tokens'),
    /** USD por 1M tokens — mesma unidade da tabela do core. */
    inputPricePerMtok: numeric('input_price_per_mtok', { precision: 12, scale: 6 }),
    outputPricePerMtok: numeric('output_price_per_mtok', { precision: 12, scale: 6 }),
    priceSource: text('price_source', {
      enum: ['provider', 'openrouter_match', 'manual', 'unknown'],
    })
      .notNull()
      .default('unknown'),
    /** Sem visão, o purpose `illustrate` quebra em silêncio (post sem capa). */
    supportsVision: boolean('supports_vision').notNull().default(false),
    supportsStructuredOutput: boolean('supports_structured_output').notNull().default(false),
    /** Resposta crua do provedor, para depurar sem re-sincronizar. */
    raw: jsonb('raw'),
    /** false = sumiu do provedor na última sincronização (não apagamos: perfis podem apontar para ele). */
    available: boolean('available').notNull().default(true),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('model_catalog_provider_model_idx').on(t.provider, t.modelId),
    index('model_catalog_available_idx').on(t.provider, t.available),
  ],
);
