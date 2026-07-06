import { LayoutTemplate } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';

export const metadata = { title: 'Templates' };

export default function TemplatesPage() {
  return (
    <>
      <PageHeader
        title="Templates de conteúdo"
        description="Prompts, buscas, extração de dados e blocos gerenciados — tudo configurável por template."
      />
      <EmptyState
        icon={LayoutTemplate}
        title="Nenhum template ainda"
        description="Os templates builtin (game-codes e artigo genérico) são semeados no milestone M2."
      />
    </>
  );
}
