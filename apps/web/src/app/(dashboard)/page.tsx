import Link from 'next/link';
import { and, count, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { AlertTriangle, CircleDollarSign, Globe, History, RefreshCw } from 'lucide-react';
import { contentJobs, getDb, llmCalls, runs, sites } from '@content-pilot/db';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { StatusBadge } from '@/components/status-badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireSession } from '@/lib/auth';

const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Worker saudável = scheduler.tick concluído nos últimos 3 minutos. */
async function isWorkerAlive(): Promise<boolean | null> {
  try {
    const result = await getDb().execute(
      sql`select max(completed_on) as last from pgboss.job where name = 'scheduler.tick' and state = 'completed'`,
    );
    const last = (result.rows?.[0] as { last: string | Date | null } | undefined)?.last;
    if (!last) return false;
    return Date.now() - new Date(last).getTime() < 3 * 60 * 1000;
  } catch {
    return null; // schema pgboss ainda não existe (worker nunca rodou)
  }
}

export default async function OverviewPage() {
  const { workspaceId } = await requireSession();
  const db = getDb();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
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
      <PageHeader
        title="Visão geral"
        description="Acompanhe sites conectados, execuções e custos de IA."
      />

      {workerAlive === false || workerAlive === null ? (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Worker inativo</p>
            <p>
              Jobs agendados e pautas não serão processados. Em desenvolvimento, rode{' '}
              <code className="rounded bg-amber-500/15 px-1 font-mono text-xs">pnpm dev:worker</code>; em produção,
              verifique o serviço <code className="rounded bg-amber-500/15 px-1 font-mono text-xs">worker</code> no
              Docker.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Sites conectados" value={String(siteCount?.value ?? 0)} icon={Globe} />
        <StatCard title="Execuções (7 dias)" value={String(runCount?.value ?? 0)} icon={History} />
        <StatCard
          title="Custo de IA no mês"
          value={`US$ ${monthCost.toFixed(2)}`}
          hint={monthTokens > 0 ? `${(monthTokens / 1000).toFixed(0)}k tokens` : 'nenhuma chamada ainda'}
          icon={CircleDollarSign}
        />
        <StatCard
          title="Próxima execução"
          value={nextJob?.next ? dateFmt.format(new Date(nextJob.next)) : '—'}
          hint={nextJob?.next ? undefined : 'nenhum job agendado'}
          icon={RefreshCw}
        />
      </div>

      {recentRuns.length === 0 ? (
        <EmptyState
          icon={History}
          title="Nenhuma execução ainda"
          description="Conecte um site WordPress e crie um job de atualização para ver as execuções aqui."
        />
      ) : (
        <Card className="py-0">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Início</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Itens</TableHead>
                  <TableHead>Custo</TableHead>
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
                      <TableCell className="text-muted-foreground text-sm">{jobName ?? 'pauta'}</TableCell>
                      <TableCell>
                        <StatusBadge status={run.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm tabular-nums">
                        {run.expectedItems ?? '—'}
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
