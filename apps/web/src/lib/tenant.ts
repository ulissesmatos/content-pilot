import 'server-only';
import { and, eq, isNull, or } from 'drizzle-orm';
import { contentTemplates, getDb } from '@content-pilot/db';

/**
 * Guardas de isolamento multi-tenant compartilhadas pelas actions.
 * Regra: um id vindo do client NUNCA é usado sem checar que pertence ao
 * workspace da sessão (ou é builtin/global).
 */

/** Template do workspace ou builtin — nunca de outro tenant. */
export async function assertTemplateAccessible(templateId: string, workspaceId: string): Promise<void> {
  const db = getDb();
  const [tpl] = await db
    .select({ id: contentTemplates.id })
    .from(contentTemplates)
    .where(
      and(
        eq(contentTemplates.id, templateId),
        or(eq(contentTemplates.workspaceId, workspaceId), isNull(contentTemplates.workspaceId)),
      ),
    )
    .limit(1);
  if (!tpl) throw new Error('Template não encontrado.');
}
