import Link from 'next/link';
import { and, count, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { AlertTriangle, CircleDollarSign, Globe, History, RefreshCw } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { contentJobs, getTenantDb, llmCalls, runs, sites } from '@content-pilot/db';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { StatusBadge } from '@/components/status-badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { isWorkerAlive } from '@/lib/worker-health';
import { requireSession } from '@/lib/auth';

export default async function OverviewPage() {
  const { workspaceId } = await requireSession();
  const db = getTenantDb(workspaceId);
  const [t, locale] = await Promise.all([getTranslations('overview'), getLocale()]);
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });
  const money = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' });

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [[siteCount], [runCount], [monthUsage], [nextJob], recentRuns, workerAlive] = await Promise.all([
    db.select({ value: count() }).from(sites).where(eq(sites.workspaceId, workspaceId)),
    db
      .select({ value: count() })
      .from(runs)
      .where(and(eq(runs.workspaceId, workspaceId), gte(runs.startedAt, sevenDaysAgo))),
    db
      .select({
        cost: sql<string>`coalesce(sum(${llmCalls.costEstimateUsd}), 0)`,
        tokens: sql<number>`coalesce(sum(${llmCalls.inputTokens} + ${llmCalls.outputTokens}), 0)`,
      })
      .from(llmCalls)
      .where(and(eq(llmCalls.workspaceId, workspaceId), gte(llmCalls.createdAt, monthStart))),
    db
      .select({ next: sql<Date | null>`min(${contentJobs.nextRunAt})`, name: sql<string>`min(${contentJobs.name})` })
      .from(contentJobs)
      .where(and(eq(contentJobs.workspaceId, workspaceId), eq(contentJobs.enabled, true), isNotNull(contentJobs.nextRunAt))),
    db
      .select({ run: runs, jobName: contentJobs.name })
      .from(runs)
      .leftJoin(contentJobs, eq(runs.jobId, contentJobs.id))
      .where(eq(runs.workspaceId, workspaceId))
      .orderBy(desc(runs.startedAt))
      .limit(8),
    isWorkerAlive(),
  ]);

  const monthCost = Number(monthUsage?.cost ?? 0);
  const monthTokens = Number(monthUsage?.tokens ?? 0);

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />

      {workerAlive === false || workerAlive === null ? (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">{t('workerDownTitle')}</p>
            <p>
              {t.rich('workerDownBody', {
                code: (chunks) => (
                  <code className="rounded bg-amber-500/15 px-1 font-mono text-xs">{chunks}</code>
                ),
              })}
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title={t('statSites')} value={String(siteCount?.value ?? 0)} icon={Globe} />
        <StatCard title={t('statRuns7d')} value={String(runCount?.value ?? 0)} icon={History} />
        <StatCard
          title={t('statMonthCost')}
          value={money.format(monthCost)}
          hint={monthTokens > 0 ? t('tokensHint', { count: (monthTokens / 1000).toFixed(0) }) : t('noCallsYet')}
          icon={CircleDollarSign}
        />
        <StatCard
          title={t('statNextRun')}
          value={nextJob?.next ? dateFmt.format(new Date(nextJob.next)) : '—'}
          hint={nextJob?.next ? undefined : t('noJobScheduled')}
          icon={RefreshCw}
        />
      </div>

      {recentRuns.length === 0 ? (
        <EmptyState icon={History} title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <Card className="py-0">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colStart')}</TableHead>
                  <TableHead>{t('colSource')}</TableHead>
                  <TableHead>{t('colStatus')}</TableHead>
                  <TableHead>{t('colItems')}</TableHead>
                  <TableHead>{t('colCost')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentRuns.map(({ run, jobName }) => {
                  const stats = (run.stats ?? {}) as Record<string, number>;
                  return (
                    <TableRow key={run.id}>
                      <TableCell>
                        <Link href={`/runs/${run.id}`} className="font-medium hover:underline">
                          {dateFmt.format(run.startedAt)}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{jobName ?? t('sourceBrief')}</TableCell>
                      <TableCell>
                        <StatusBadge status={run.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm tabular-nums">
                        {run.expectedItems ?? '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm tabular-nums">
                        {stats.costEstimateUsd ? money.format(Number(stats.costEstimateUsd)) : '—'}
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
