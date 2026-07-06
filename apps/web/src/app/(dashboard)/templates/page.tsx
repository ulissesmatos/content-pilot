import Link from 'next/link';
import { desc, eq, isNull, or } from 'drizzle-orm';
import { LayoutTemplate } from 'lucide-react';
import { contentTemplates, getDb } from '@content-pilot/db';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { CloneTemplateButton, DeleteTemplateButton } from '@/components/templates/template-row-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireSession } from '@/lib/auth';

export const metadata = { title: 'Templates' };

export default async function TemplatesPage() {
  const { workspaceId } = await requireSession();
  const rows = await getDb()
    .select()
    .from(contentTemplates)
    .where(or(isNull(contentTemplates.workspaceId), eq(contentTemplates.workspaceId, workspaceId)))
    .orderBy(desc(contentTemplates.isBuiltin), desc(contentTemplates.createdAt));

  return (
    <>
      <PageHeader
        title="Templates de conteúdo"
        description="Prompts, buscas, extração de dados e blocos gerenciados — tudo configurável. Clone um builtin para customizar."
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={LayoutTemplate}
          title="Nenhum template"
          description="Rode o seed do banco (pnpm db:seed) para criar os templates builtin."
        />
      ) : (
        <Card className="py-0">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Template</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Idiomas</TableHead>
                  <TableHead>Versão</TableHead>
                  <TableHead className="w-64" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => {
                  const config = t.config as { prompts?: Record<string, unknown> } | null;
                  const locales = Object.keys(config?.prompts ?? {});
                  return (
                    <TableRow key={t.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{t.name}</span>
                          {t.isBuiltin ? <Badge variant="secondary">builtin</Badge> : null}
                        </div>
                        {t.description ? (
                          <p className="text-muted-foreground mt-0.5 max-w-xl truncate text-xs">{t.description}</p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">{t.slug}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {locales.map((l) => (
                            <Badge key={l} variant="outline" className="text-[10px]">
                              {l}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm tabular-nums">v{t.version}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="outline" size="sm" asChild>
                            <Link href={`/templates/${t.id}`}>{t.isBuiltin ? 'Ver' : 'Editar'}</Link>
                          </Button>
                          <CloneTemplateButton id={t.id} />
                          {!t.isBuiltin ? <DeleteTemplateButton id={t.id} name={t.name} /> : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
