import { boolean, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

/**
 * Template de conteúdo. `config` é um JSONB validado pelo zod schema em
 * @content-pilot/core (templates/schema.ts): queries de busca por locale,
 * block/trust lists, prompts por locale, schema de extração, bloco gerenciado.
 * Templates builtin têm workspaceId NULL e isBuiltin=true (read-only no
 * painel; o usuário clona para customizar).
 */
export const contentTemplates = pgTable(
  'content_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    version: integer('version').notNull().default(1),
    config: jsonb('config').notNull(),
    isBuiltin: boolean('is_builtin').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('content_templates_workspace_slug_uq').on(t.workspaceId, t.slug).nullsNotDistinct()],
);
