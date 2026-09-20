import { boolean, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * Perfil de modelo: um conjunto nomeado de escolhas (um modelo por purpose)
 * que os planos referenciam.
 *
 * É o que permite ao plano mais caro usar um modelo melhor sem o cliente
 * escolher nada — a escolha é do admin, e o custo por post fica conhecido de
 * antemão. Com o modelo fixo, limitar por post basta; com o cliente
 * escolhendo, um plano de US$ 79 podia custar US$ 300 de IA.
 */
export const modelProfiles = pgTable('model_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  /** Usado quando o plano não aponta perfil algum (e por quem não tem plano). */
  isDefault: boolean('is_default').notNull().default(false),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const modelProfileEntries = pgTable(
  'model_profile_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => modelProfiles.id, { onDelete: 'cascade' }),
    /** Mesma lista de llm_calls.purpose — a constante vive em core/llm/purposes.ts. */
    purpose: text('purpose', {
      enum: ['generate', 'verify', 'discover', 'dedupe', 'illustrate', 'review'],
    }).notNull(),
    provider: text('provider', { enum: ['anthropic', 'openai', 'openrouter'] }).notNull(),
    modelId: text('model_id').notNull(),
    maxTokens: integer('max_tokens'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('model_profile_entries_profile_purpose_idx').on(t.profileId, t.purpose)],
);
