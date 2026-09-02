import Link from 'next/link';
import { desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { ExternalLink, PenLine } from 'lucide-react';
import { briefs, contentTemplates, getDb, runs, sites } from '@content-pilot/db';
import { CreateBriefDialog, EditBriefButton, type BriefFormInitial } from '@/components/briefs/create-brief-dialog';
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
import { getLocale, getTranslations } from 'next-intl/server';
import { requireSession } from '@/lib/auth';

export const metadata = { title: 'Criar posts' };

export default async function BriefsPage() {
  const { workspaceId } = await requireSession();
  const db = getDb();
  const [t, locale] = await Promise.all([getTranslations('briefs'), getLocale()]);
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });

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

  const toInitial = (brief: (typeof briefRows)[number]['brief']): BriefFormInitial => {
    const llm = (brief.llmConfig ?? {}) as { generate?: { provider?: string; model?: string } };
    return {
      id: brief.id,
      topic: brief.topic,
      language: brief.language,
      keywords: (brief.keywords ?? []).join(', '),
      targetCategoryWpId: brief.targetCategoryWpId ? String(brief.targetCategoryWpId) : '',
      extraInstructions: brief.extraInstructions ?? '',
      publishMode: brief.publishMode,
      provider: llm.generate?.provider ?? 'openrouter',
      model: llm.generate?.model ?? '',
    };
  };

  return (
    <>
      <AutoRefresh enabled={hasActive} />
      <PageHeader title={t('title')} description={t('description')}>
        <CreateBriefDialog sites={siteRows} templates={templateRows} />
      </PageHeader>
      {briefRows.length === 0 ? (
        <EmptyState icon={PenLine} title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <Card className="py-0">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colTopic')}</TableHead>
                  <TableHead>{t('colSite')}</TableHead>
                  <TableHead>{t('colTemplate')}</TableHead>
                  <TableHead>{t('colStatus')}</TableHead>
                  <TableHead>{t('colCreatedAt')}</TableHead>
                  <TableHead>{t('colPost')}</TableHead>
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
                              {t('runLink')}
                            </Link>
                          ) : null}
                          {brief.status === 'failed' ? <RegenerateBriefButton id={brief.id} /> : null}
                          {brief.status === 'ready_for_review' ? <PublishBriefButton id={brief.id} /> : null}
                          {brief.status === 'pending' || brief.status === 'failed' ? (
                            <EditBriefButton initial={toInitial(brief)} />
                          ) : null}
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
