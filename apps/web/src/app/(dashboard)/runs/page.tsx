import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { History } from 'lucide-react';
import { contentJobs, getDb, runs } from '@content-pilot/db';
import { AutoRefresh } from '@/components/auto-refresh';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireSession } from '@/lib/auth';

export const metadata = { title: 'Execuções' };

const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });

export default async function RunsPage() {
  const { workspaceId } = await requireSession();
  const rows = await getDb()
    .select({ run: runs, jobName: contentJobs.name })
    .from(runs)
    .leftJoin(contentJobs, eq(runs.jobId, contentJobs.id))
    .where(eq(runs.workspaceId, workspaceId))
    .orderBy(desc(runs.startedAt))
    .limit(50);

  const hasRunning = rows.some((r) => r.run.status === 'running');

  return (
    <>
      <AutoRefresh enabled={hasRunning} />
      <PageHeader
        title="Execuções"
        description="Histórico de execuções com fontes, dados extraídos, tokens e custo por post."
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={History}
          title="Nenhuma execução registrada"
          description='Crie um job e use "Executar agora" para ver a primeira execução aqui.'
        />
      ) : (
        <Card className="py-0">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Início</TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead>Disparo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Itens</TableHead>
                  <TableHead>Tokens</TableHead>
                  <TableHead>Custo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ run, jobName }) => {
                  const stats = (run.stats ?? {}) as Record<string, number>;
                  return (
                    <TableRow key={run.id}>
                      <TableCell>
                        <Link href={`/runs/${run.id}`} className="font-medium hover:underline">
                          {dateFmt.format(run.startedAt)}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{jobName ?? 'pauta'}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {run.trigger === 'cron' ? 'agendado' : 'manual'}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={run.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm tabular-nums">
                        {run.expectedItems ?? '—'}
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
