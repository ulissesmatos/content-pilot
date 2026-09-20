import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { History } from 'lucide-react';
import { autopilotConfigs, briefs, contentJobs, getTenantDb, runs } from '@content-pilot/db';
import { AutoRefresh } from '@/components/auto-refresh';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { RunTypeBadge } from '@/components/run-type-badge';
import { StatusBadge } from '@/components/status-badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getLocale, getTranslations } from 'next-intl/server';
import { requireSession } from '@/lib/auth';
import { dateTimeFormat } from '@/lib/datetime';

export const metadata = { title: 'Execuções' };

/** Chaves de métrica em runs.stats — o que sobra são contagens por status de item. */
const METRIC_KEYS = new Set(['tokensIn', 'tokensOut', 'costEstimateUsd', 'discovered', 'queued', 'pending', 'discarded', 'sources']);

function itemsLabel(kind: string, stats: Record<string, number>, expectedItems: number | null): string {
  if (kind === 'discover') return stats.discovered !== undefined ? String(stats.discovered) : '—';
  const done = Object.entries(stats)
    .filter(([k, v]) => !METRIC_KEYS.has(k) && typeof v === 'number')
    .reduce((acc, [, v]) => acc + v, 0);
  if (Object.keys(stats).length === 0) return expectedItems !== null ? `0 / ${expectedItems}` : '—';
  return expectedItems !== null ? `${done} / ${expectedItems}` : String(done);
}

export default async function RunsPage() {
  const { workspaceId } = await requireSession();
  const [t, locale] = await Promise.all([getTranslations('runs'), getLocale()]);
  const dateFmt = dateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' });
  const rows = await getTenantDb(workspaceId)
    .select({
      run: runs,
      jobName: contentJobs.name,
      briefTopic: briefs.topic,
      autopilotName: autopilotConfigs.name,
    })
    .from(runs)
    .leftJoin(contentJobs, eq(runs.jobId, contentJobs.id))
    .leftJoin(briefs, eq(runs.briefId, briefs.id))
    .leftJoin(autopilotConfigs, eq(runs.autopilotConfigId, autopilotConfigs.id))
    .where(eq(runs.workspaceId, workspaceId))
    .orderBy(desc(runs.startedAt))
    .limit(50);

  const hasRunning = rows.some((r) => r.run.status === 'running');

  return (
    <>
      <AutoRefresh enabled={hasRunning} />
      <PageHeader title={t('title')} description={t('description')} />
      {rows.length === 0 ? (
        <EmptyState icon={History} title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <Card className="py-0">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colStart')}</TableHead>
                  <TableHead>{t('colType')}</TableHead>
                  <TableHead>{t('colSource')}</TableHead>
                  <TableHead>{t('colTrigger')}</TableHead>
                  <TableHead>{t('colStatus')}</TableHead>
                  <TableHead>{t('colItems')}</TableHead>
                  <TableHead>{t('colTokens')}</TableHead>
                  <TableHead>{t('colCost')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ run, jobName, briefTopic, autopilotName }) => {
                  const stats = (run.stats ?? {}) as Record<string, number>;
                  // origem específica do tipo primeiro (geração do autopilot mostra o tópico da pauta)
                  const source =
                    (run.kind === 'create' ? briefTopic : run.kind === 'discover' ? autopilotName : jobName) ??
                    briefTopic ??
                    jobName ??
                    autopilotName ??
                    '—';
                  return (
                    <TableRow key={run.id}>
                      <TableCell>
                        <Link href={`/runs/${run.id}`} className="font-medium hover:underline">
                          {dateFmt.format(run.startedAt)}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <RunTypeBadge type={run.kind} />
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-48 truncate text-sm">
                        {source}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {run.trigger === 'cron'
                          ? t('triggerCron')
                          : run.trigger === 'autopilot'
                            ? t('triggerAutopilot')
                            : t('triggerManual')}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={run.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm tabular-nums">
                        {itemsLabel(run.kind, stats, run.expectedItems)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm tabular-nums">
                        {stats.tokensIn ? `${stats.tokensIn} / ${stats.tokensOut}` : '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm tabular-nums">
                        {stats.costEstimateUsd ? `US$ ${Number(stats.costEstimateUsd).toFixed(4)}` : '—'}
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
