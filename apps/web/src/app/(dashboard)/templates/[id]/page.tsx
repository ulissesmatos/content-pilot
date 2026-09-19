import { notFound } from 'next/navigation';
import { and, eq, isNull, or } from 'drizzle-orm';
import { contentTemplates, getTenantDb } from '@content-pilot/db';
import { PageHeader } from '@/components/page-header';
import { TemplateEditor } from '@/components/templates/template-editor';
import { Badge } from '@/components/ui/badge';
import { requireSession } from '@/lib/auth';

export const metadata = { title: 'Editar template' };

export default async function TemplateEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspaceId } = await requireSession();

  const [template] = await getTenantDb(workspaceId)
    .select()
    .from(contentTemplates)
    .where(
      and(
        eq(contentTemplates.id, id),
        or(isNull(contentTemplates.workspaceId), eq(contentTemplates.workspaceId, workspaceId)),
      ),
    )
    .limit(1);
  if (!template) notFound();

  return (
    <>
      <PageHeader
        title={template.name}
        description={
          template.isBuiltin
            ? 'Template builtin — somente leitura. Clone na lista de templates para customizar.'
            : `slug: ${template.slug} · v${template.version}`
        }
      >
        {template.isBuiltin ? <Badge variant="secondary">builtin</Badge> : null}
      </PageHeader>
      <TemplateEditor
        id={template.id}
        initialName={template.name}
        initialDescription={template.description ?? ''}
        initialConfig={template.config as Record<string, unknown>}
        readOnly={template.isBuiltin}
      />
    </>
  );
}
