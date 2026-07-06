import { count, eq, gte } from 'drizzle-orm';
import { CircleDollarSign, Globe, History, RefreshCw } from 'lucide-react';
import { getDb, runs, sites } from '@content-pilot/db';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { requireSession } from '@/lib/auth';

export default async function OverviewPage() {
  const { workspaceId } = await requireSession();
  const db = getDb();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [siteCount] = await db
    .select({ value: count() })
    .from(sites)
    .where(eq(sites.workspaceId, workspaceId));
  const [runCount] = await db
    .select({ value: count() })
    .from(runs)
    .where(gte(runs.startedAt, sevenDaysAgo));

  return (
    <>
      <PageHeader
        title="Visão geral"
        description="Acompanhe sites conectados, execuções e custos de IA."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Sites conectados" value={String(siteCount?.value ?? 0)} icon={Globe} />
        <StatCard
          title="Execuções (7 dias)"
          value={String(runCount?.value ?? 0)}
          icon={History}
        />
        <StatCard title="Custo de IA no mês" value="US$ 0,00" hint="nenhuma chamada ainda" icon={CircleDollarSign} />
        <StatCard title="Próxima execução" value="—" hint="nenhum job agendado" icon={RefreshCw} />
      </div>
      <EmptyState
        icon={History}
        title="Nenhuma execução ainda"
        description="Conecte um site WordPress e crie um job de atualização para ver as execuções aqui."
      />
    </>
  );
}
