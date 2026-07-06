import { notFound } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { contentJobs, getDb, runItems, runs } from '@content-pilot/db';
import { AutoRefresh } from '@/components/auto-refresh';
import { PageHeader } from '@/components/page-header';
import { RunItemCard, type RunItemView } from '@/components/runs/run-item-card';
import { StatusBadge } from '@/components/status-badge';
import { Card, CardContent } from '@/components/ui/card';
import { requireSession } from '@/lib/auth';

export const metadata = { title: 'Execução' };

const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspaceId } = await requireSession();
  const db = getDb();

  const [row] = await db
    .select({ run: runs, jobName: contentJobs.name })
    .from(runs)
    .leftJoin(contentJobs, eq(runs.jobId, contentJobs.id))
    .where(and(eq(runs.id, id), eq(runs.workspaceId, workspaceId)))
    .limit(1);
  if (!row) notFound();
  const { run, jobName } = row;

  const items = await db.select().from(runItems).where(eq(runItems.runId, id)).orderBy(asc(runItems.createdAt));
  const stats = (run.stats ?? {}) as Record<string, number>;
  const isRunning = run.status === 'running';

  return (
    <>
      <AutoRefresh enabled={isRunning} />
      <PageHeader
        title={`Execução de ${dateFmt.format(run.startedAt)}`}
        description={`${jobName ?? 'pauta'} · disparo ${run.trigger === 'cron' ? 'agendado' : 'manual'}`}
      >
        <StatusBadge status={run.status} />
      </PageHeader>

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          <div>
            <p className="text-muted-foreground text-xs">Itens processados</p>
            <p className="text-lg font-semibold tabular-nums">
              {items.length}
              {run.expectedItems !== null ? ` / ${run.expectedItems}` : ''}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Tokens (in/out)</p>
            <p className="text-lg font-semibold tabular-nums">
              {stats.tokensIn ? `${stats.tokensIn} / ${stats.tokensOut}` : '—'}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Custo estimado</p>
            <p className="text-lg font-semibold tabular-nums">
              {stats.costEstimateUsd ? `US$ ${Number(stats.costEstimateUsd).toFixed(4)}` : '—'}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Início</p>
            <p className="text-sm font-medium">{dateFmt.format(run.startedAt)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Fim</p>
            <p className="text-sm font-medium">{run.finishedAt ? dateFmt.format(run.finishedAt) : 'em andamento…'}</p>
          </div>
          {run.error ? (
            <div className="col-span-2">
              <p className="text-muted-foreground text-xs">Erro</p>
              <p className="text-destructive text-sm">{run.error}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="space-y-2">
        {items.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">
            {isRunning ? 'Aguardando o worker processar os posts…' : 'Nenhum item registrado.'}
          </p>
        ) : (
          items.map((item) => <RunItemCard key={item.id} item={item as unknown as RunItemView} />)
        )}
      </div>
    </>
  );
}
