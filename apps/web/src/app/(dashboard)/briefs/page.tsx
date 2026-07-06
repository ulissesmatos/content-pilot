import Link from 'next/link';
import { desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { ExternalLink, PenLine } from 'lucide-react';
import { briefs, contentTemplates, getDb, runs, sites } from '@content-pilot/db';
import { CreateBriefDialog } from '@/components/briefs/create-brief-dialog';
import {
  DeleteBriefButton,
  PublishBriefButton,
  RegenerateBriefButton,
} from '@/components/briefs/brief-row-actions';
import { AutoRefresh } from '@/components/auto-refresh';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireSession } from '@/lib/auth';

export const metadata = { title: 'Pautas' };

const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export default async function BriefsPage() {
  const { workspaceId } = await requireSession();
  const db = getDb();

  const [briefRows, siteRows, templateRows] = await Promise.all([
    db
      .select({ brief: briefs, siteName: sites.name, templateName: contentTemplates.name })
      .from(briefs)
      .innerJoin(sites, eq(briefs.siteId, sites.id))
      .innerJoin(contentTemplates, eq(briefs.templateId, contentTemplates.id))
      .where(eq(briefs.workspaceId, workspaceId))
      .orderBy(desc(briefs.createdAt))
      .limit(100),
    db.select({ id: sites.id, name: sites.name }).from(sites).where(eq(sites.workspaceId, workspaceId)),
    db
      .select({ id: contentTemplates.id, name: contentTemplates.name })
      .from(contentTemplates)
      .where(or(isNull(contentTemplates.workspaceId), eq(contentTemplates.workspaceId, workspaceId))),
  ]);

  // Última execução de cada pauta (link para a auditoria)
  const briefIds = briefRows.map((r) => r.brief.id);
  const runRows = briefIds.length
    ? await db
        .select({ id: runs.id, briefId: runs.briefId, startedAt: runs.startedAt })
        .from(runs)
        .where(inArray(runs.briefId, briefIds))
        .orderBy(desc(runs.startedAt))
    : [];
  const latestRunByBrief = new Map<string, string>();
  for (const r of runRows) {
    if (r.briefId && !latestRunByBrief.has(r.briefId)) latestRunByBrief.set(r.briefId, r.id);
  }

  const hasActive = briefRows.some((r) => r.brief.status === 'queued' || r.brief.status === 'generating');

  return (
    <>
      <AutoRefresh enabled={hasActive} />
      <PageHeader
        title="Pautas"
        description="Gera artigos novos a partir de um tópico, com pesquisa na web como base factual."
      >
        <CreateBriefDialog sites={siteRows} templates={templateRows} />
      </PageHeader>
      {briefRows.length === 0 ? (
        <EmptyState
          icon={PenLine}
          title="Nenhuma pauta criada"
          description="Crie uma pauta com o assunto do artigo — o sistema pesquisa fontes, escreve e salva como rascunho no WordPress."
        />
      ) : (
        <Card className="py-0">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tópico</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Criada em</TableHead>
                  <TableHead>Post</TableHead>
                  <TableHead className="w-64" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {briefRows.map(({ brief, siteName, templateName }) => {
                  const runId = latestRunByBrief.get(brief.id);
                  return (
                    <TableRow key={brief.id}>
                      <TableCell className="max-w-64">
                        <p className="truncate font-medium">{brief.topic}</p>
                        {brief.error ? (
                          <p className="text-destructive max-w-full truncate text-xs">{brief.error}</p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{siteName}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{templateName}</TableCell>
                      <TableCell>
                        <StatusBadge status={brief.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {dateFmt.format(brief.createdAt)}
                      </TableCell>
                      <TableCell>
                        {brief.createdWpPostUrl ? (
                          <a
                            href={
                              brief.status === 'ready_for_review'
                                ? `${brief.createdWpPostUrl}${brief.createdWpPostUrl.includes('?') ? '&' : '?'}preview=true`
                                : brief.createdWpPostUrl
                            }
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
                          >
                            #{brief.createdWpPostId}
                            <ExternalLink className="size-3" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {runId ? (
                            <Link href={`/runs/${runId}`} className="text-muted-foreground text-xs hover:underline">
                              execução
                            </Link>
                          ) : null}
                          {brief.status === 'failed' ? <RegenerateBriefButton id={brief.id} /> : null}
                          {brief.status === 'ready_for_review' ? <PublishBriefButton id={brief.id} /> : null}
                          <DeleteBriefButton id={brief.id} topic={brief.topic} />
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
