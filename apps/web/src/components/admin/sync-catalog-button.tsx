'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { syncCatalogAction } from '@/actions/admin/catalog';
import { Button } from '@/components/ui/button';

export function SyncCatalogButton() {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await syncCatalogAction({});
          if (res.ok) {
            // enfileirado: o worker processa em segundos, a página não espera
            toast.success('Sincronização enfileirada. Atualize em alguns segundos.');
          } else {
            toast.error(res.error);
          }
        })
      }
    >
      <RefreshCw className="size-4" />
      {pending ? 'Enfileirando...' : 'Sincronizar agora'}
    </Button>
  );
}
