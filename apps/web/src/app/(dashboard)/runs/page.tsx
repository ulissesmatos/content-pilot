import { History } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';

export const metadata = { title: 'Execuções' };

export default function RunsPage() {
  return (
    <>
      <PageHeader
        title="Execuções"
        description="Histórico e auditoria de cada execução: fontes, dados extraídos, tokens e custo."
      />
      <EmptyState
        icon={History}
        title="Nenhuma execução registrada"
        description="As execuções aparecem aqui quando o worker rodar o primeiro job (M3)."
      />
    </>
  );
}
