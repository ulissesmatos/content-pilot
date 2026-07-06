import { Globe } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';

export const metadata = { title: 'Sites' };

export default function SitesPage() {
  return (
    <>
      <PageHeader title="Sites" description="Conexões com sites WordPress via REST API." />
      <EmptyState
        icon={Globe}
        title="Nenhum site conectado"
        description="O CRUD de sites com teste de conexão chega no próximo milestone (M1)."
      />
    </>
  );
}
