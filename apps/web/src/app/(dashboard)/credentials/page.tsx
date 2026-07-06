import { KeyRound } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';

export const metadata = { title: 'Credenciais' };

export default function CredentialsPage() {
  return (
    <>
      <PageHeader
        title="Credenciais"
        description="Chaves de API e senhas armazenadas criptografadas (AES-256-GCM)."
      />
      <EmptyState
        icon={KeyRound}
        title="Nenhuma credencial salva"
        description="O vault criptografado chega no milestone M1."
      />
    </>
  );
}
