import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asc, desc, eq } from 'drizzle-orm';
import {
  and,
  autopilotConfigs,
  briefs,
  contentJobs,
  discoveredTopics,
  getTenantDb,
  llmCalls,
  runItems,
  runLogs,
  runs,
  sites,
} from '@content-pilot/db';
import { CONTENT_TYPE_LABELS, type ContentType } from '@content-pilot/core';
import { ExternalLink } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { AutoRefresh } from '@/components/auto-refresh';
import { PageHeader } from '@/components/page-header';
import { RunItemCard, type RunItemView } from '@/components/runs/run-item-card';
import { RunLog } from '@/components/runs/run-log';
import { RunTypeBadge } from '@/components/run-type-badge';
import { StopRunButton } from '@/components/runs/stop-run-button';
import { StatusBadge } from '@/components/status-badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireSession } from '@/lib/auth';
import { dateTimeFormat } from '@/lib/datetime';

export const metadata = { title: 'Execução' };

/** Chaves de métrica em runs.stats — o que sobra são contagens por status de item. */
const METRIC_KEYS = new Set(['tokensIn', 'tokensOut', 'costEstimateUsd', 'discovered', 'queued', 'pending', 'discarded', 'sources']);
/** Statuses de item que aceitam retry manual (espelha a action retryRunItemAction). */
const RETRYABLE = new Set(['llm_failed', 'wp_failed', 'validation_failed', 'failed', 'budget_exceeded']);

function typeLabel(t: string) {
  return CONTENT_TYPE_LABELS[t as ContentType] ?? t;
}

/** Prévia textual do backup (sem tags/comentários), truncada para o client. */
function backupPreview(html: string | null): string | null {
  if (!html) return null;
  const text = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, 1500) : null;
}

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspaceId } = await requireSession();
  const db = getTenantDb(workspaceId);
  const [t, tRuns, tStatus, locale] = await Promise.all([
    getTranslations('runDetail'),
    getTranslations('runs'),
    getTranslations('status'),
    getLocale(),
  ]);
  const dateFmt = dateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' });
  const timeFmt = dateTimeFormat(locale, { timeStyle: 'medium' });

  const [row] = await db
    .select({
      run: runs,
      jobName: contentJobs.name,
      jobSiteId: contentJobs.siteId,
      briefTopic: briefs.topic,
      briefSiteId: briefs.siteId,
      briefWpPostUrl: briefs.createdWpPostUrl,
      autopilotName: autopilotConfigs.name,
    })
    .from(runs)
    .leftJoin(contentJobs, eq(runs.jobId, contentJobs.id))
    .leftJoin(briefs, eq(runs.briefId, briefs.id))
    .leftJoin(autopilotConfigs, eq(runs.autopilotConfigId, autopilotConfigs.id))
    .where(and(eq(runs.id, id), eq(runs.workspaceId, workspaceId)))
    .limit(1);
  if (!row) notFound();
  const { run, jobName, jobSiteId, briefTopic, briefSiteId, briefWpPostUrl, autopilotName } = row;

  const kind = run.kind;
  const source =
    (kind === 'create' ? briefTopic : kind === 'discover' ? autopilotName : jobName) ??
    briefTopic ??
    jobName ??
    autopilotName ??
    t('sourceFallback');
  const triggerWord =
    run.trigger === 'cron' ? tRuns('triggerCron') : run.trigger === 'autopilot' ? tRuns('triggerAutopilot') : tRuns('triggerManual');

  const stats = (run.stats ?? {}) as Record<string, number>;
  const isRunning = run.status === 'running';

  // Descoberta não gera run_items — o resultado vive em discovered_topics.
  const [items, discovered, calls, logLines, site] = await Promise.all([
    kind === 'discover'
      ? Promise.resolve([])
      : db.select().from(runItems).where(eq(runItems.runId, id)).orderBy(asc(runItems.createdAt)),
    kind === 'discover'
      ? db.select().from(discoveredTopics).where(eq(discoveredTopics.runId, id)).orderBy(desc(discoveredTopics.createdAt))
      : Promise.resolve([]),
    db.select().from(llmCalls).where(eq(llmCalls.runId, id)).orderBy(asc(llmCalls.createdAt)),
    db.select().from(runLogs).where(eq(runLogs.runId, id)).orderBy(asc(runLogs.ts), asc(runLogs.id)),
    (async () => {
      const siteId = jobSiteId ?? briefSiteId;
      if (!siteId) return null;
      const [s] = await db.select({ baseUrl: sites.baseUrl }).from(sites).where(eq(sites.id, siteId)).limit(1);
      return s ?? null;
    })(),
  ]);

  const breakdown = Object.entries(stats)
    .filter(([k, v]) => !METRIC_KEYS.has(k) && typeof v === 'number' && v > 0)
    .sort((a, b) => b[1] - a[1]);

  const itemViews: RunItemView[] = items.map((item) => ({
    id: item.id,
    wpPostId: item.wpPostId,
    postTitle: item.postTitle,
    status: item.status,
    action: item.action,
    changesSummary: item.changesSummary,
    extractedData: item.extractedData as RunItemView['extractedData'],
    rejectedData: item.rejectedData as RunItemView['rejectedData'],
    droppedData: item.droppedData as RunItemView['droppedData'],
    validationErrors: item.validationErrors as RunItemView['validationErrors'],
    sources: item.sources as RunItemView['sources'],
    durationMs: item.durationMs,
    postUrl:
      item.wpPostId && site
        ? kind === 'create' && briefWpPostUrl
          ? briefWpPostUrl
          : `${site.baseUrl.replace(/\/+$/, '')}/?p=${item.wpPostId}`
        : null,
    hasBackup: !!item.previousContentBackup,
    backupPreview: backupPreview(item.previousContentBackup),
    canRetry: kind === 'update' && !isRunning && RETRYABLE.has(item.status) && !!item.wpPostId && !!run.jobId,
  }));

  return (
    <>
      <AutoRefresh enabled={isRunning} />
      <PageHeader
        title={t('title', { date: dateFmt.format(run.startedAt) })}
        description={`${source} · ${t('trigger', { trigger: triggerWord })}`}
      >
        {isRunning ? <StopRunButton runId={run.id} /> : null}
        <RunTypeBadge type={kind} />
        <StatusBadge status={run.status} />
      </PageHeader>

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          {kind === 'discover' ? (
            <>
              <div>
                <p className="text-muted-foreground text-xs">{t('newTopics')}</p>
                <p className="text-lg font-semibold tabular-nums">{stats.discovered ?? 0}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">{t('discardedTopics')}</p>
                <p className="text-lg font-semibold tabular-nums">{stats.discarded ?? 0}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">{t('sourcesAnalyzed')}</p>
                <p className="text-lg font-semibold tabular-nums">{stats.sources ?? 0}</p>
              </div>
            </>
          ) : (
            <div>
              <p className="text-muted-foreground text-xs">{t('itemsProcessed')}</p>
              <p className="text-lg font-semibold tabular-nums">
                {items.length}
                {run.expectedItems !== null ? ` / ${run.expectedItems}` : ''}
              </p>
            </div>
          )}
          <div>
            <p className="text-muted-foreground text-xs">{t('tokens')}</p>
            <p className="text-lg font-semibold tabular-nums">
              {stats.tokensIn ? `${stats.tokensIn} / ${stats.tokensOut}` : '—'}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">{t('cost')}</p>
            <p className="text-lg font-semibold tabular-nums">
              {stats.costEstimateUsd ? `US$ ${Number(stats.costEstimateUsd).toFixed(4)}` : '—'}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">{t('start')}</p>
            <p className="text-sm font-medium">{dateFmt.format(run.startedAt)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">{t('end')}</p>
            <p className="text-sm font-medium">{run.finishedAt ? dateFmt.format(run.finishedAt) : t('inProgress')}</p>
          </div>
          {kind === 'create' && briefTopic ? (
            <div className="col-span-2">
              <p className="text-muted-foreground text-xs">{t('briefLabel')}</p>
              <p className="truncate text-sm font-medium">
                {briefWpPostUrl ? (
                  <a
                    href={briefWpPostUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex max-w-full items-center gap-1 hover:underline"
                  >
                    <span className="truncate">{briefTopic}</span>
                    <ExternalLink className="size-3.5 shrink-0" />
                  </a>
                ) : (
                  briefTopic
                )}
              </p>
            </div>
          ) : null}
          {run.error ? (
            <div className="col-span-2">
              <p className="text-muted-foreground text-xs">{t('error')}</p>
              <p className="text-destructive text-sm">{run.error}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {kind !== 'discover' && breakdown.length > 0 ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{t('breakdown')}</p>
            {breakdown.map(([status, count]) => (
              <span key={status} className="flex items-center gap-2">
                <StatusBadge status={status} />
                <span className="text-sm font-semibold tabular-nums">{count}</span>
              </span>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {kind === 'discover' ? (
        <div className="space-y-2">
          {discovered.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              {isRunning ? t('discoveryEmptyRunning') : t('discoveryEmpty')}
            </p>
          ) : (
            <Card className="py-0">
              <CardContent className="divide-border divide-y p-0">
                {discovered.map((topic) => (
                  <div key={topic.id} className="flex items-start justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-medium">{topic.suggestedTitle || topic.topic}</p>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        {typeLabel(topic.contentType)}
                        {topic.discardReason ? ` · ${topic.discardReason}` : ''}
                        {topic.briefId ? ` · ${t('becameBrief')}` : ''}
                      </p>
                    </div>
                    <StatusBadge status={topic.status} />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          <p className="text-muted-foreground text-center text-xs">
            {t('discoveryFooter')}{' '}
            <Link href="/briefs" className="underline underline-offset-2">
              {t('discoveryFooterLink')}
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {itemViews.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              {isRunning ? t('itemsEmptyRunning') : t('itemsEmpty')}
            </p>
          ) : (
            itemViews.map((item) => <RunItemCard key={item.id} item={item} />)
          )}
        </div>
      )}

      {calls.length > 0 ? (
        <Card className="py-0">
          <CardContent className="p-0">
            <p className="text-muted-foreground border-b px-4 py-3 text-xs font-medium uppercase tracking-wide">
              {t('llmCalls', { count: calls.length })}
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('llmColTime')}</TableHead>
                  <TableHead>{t('llmColPurpose')}</TableHead>
                  <TableHead>{t('llmColModel')}</TableHead>
                  <TableHead>{t('llmColTokens')}</TableHead>
                  <TableHead>{t('llmColCost')}</TableHead>
                  <TableHead>{t('llmColDuration')}</TableHead>
                  <TableHead>{t('llmColStatus')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calls.map((call) => (
                  <TableRow key={call.id}>
                    <TableCell className="text-muted-foreground text-sm tabular-nums">
                      {timeFmt.format(call.createdAt)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {t(`purpose_${call.purpose}` as Parameters<typeof t>[0])}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-56 truncate text-sm">
                      {call.provider}/{call.model}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm tabular-nums">
                      {call.inputTokens} / {call.outputTokens}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm tabular-nums">
                      {call.costEstimateUsd ? `US$ ${Number(call.costEstimateUsd).toFixed(4)}` : '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm tabular-nums">
                      {call.durationMs ? `${(call.durationMs / 1000).toFixed(1)}s` : '—'}
                    </TableCell>
                    <TableCell>
                      {call.status === 'ok' ? (
                        <span className="text-muted-foreground text-sm">{tStatus('success')}</span>
                      ) : (
                        <StatusBadge status={call.status} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <RunLog
        lines={logLines.map((l) => ({ id: l.id, ts: l.ts.toISOString(), line: l.line }))}
        defaultOpen={isRunning || run.status === 'failed'}
      />
    </>
  );
}
