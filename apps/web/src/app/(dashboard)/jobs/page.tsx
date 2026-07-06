import { RefreshCw } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';

export const metadata = { title: 'Jobs de atualização' };

export default function JobsPage() {
  return (
    <>
      <PageHeader
        title="Jobs de atualização"
        description="Atualização periódica de posts por categoria/tag com agendamento cron."
      />
      <EmptyState
        icon={RefreshCw}
        title="Nenhum job configurado"
        description="Jobs agendados com pg-boss chegam no milestone M3."
      />
    </>
  );
}
