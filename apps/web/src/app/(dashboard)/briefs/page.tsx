import { PenLine } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';

export const metadata = { title: 'Pautas' };

export default function BriefsPage() {
  return (
    <>
      <PageHeader
        title="Pautas"
        description="Geração de posts novos a partir de tópicos, com pesquisa em fontes reais."
      />
      <EmptyState
        icon={PenLine}
        title="Nenhuma pauta criada"
        description="A geração de posts chega no milestone M5."
      />
    </>
  );
}
