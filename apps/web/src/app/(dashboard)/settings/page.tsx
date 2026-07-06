import { Settings } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';

export const metadata = { title: 'Configurações' };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Configurações" description="Perfil, senha e orçamento mensal de IA." />
      <EmptyState
        icon={Settings}
        title="Em breve"
        description="Perfil e orçamento global de tokens serão configuráveis aqui."
      />
    </>
  );
}
