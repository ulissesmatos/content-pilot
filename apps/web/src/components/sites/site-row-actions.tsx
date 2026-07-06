'use client';

import { useState, useTransition } from 'react';
import { PlugZap, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { deleteSiteAction, testSiteConnectionAction } from '@/actions/sites';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export function TestConnectionButton({ siteId }: { siteId: string }) {
  const [pending, startTransition] = useTransition();

  function test() {
    startTransition(async () => {
      const result = await testSiteConnectionAction({ id: siteId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.data.ok) {
        const editWarning = result.data.canEdit === false ? ' — atenção: usuário sem permissão de edição' : '';
        toast.success(`Conexão OK — autenticado como ${result.data.user}${editWarning}`);
      } else {
        toast.error(result.data.error ?? 'Falha na conexão');
      }
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={test} disabled={pending}>
      <PlugZap className="size-4" />
      {pending ? 'Testando...' : 'Testar conexão'}
    </Button>
  );
}

export function DeleteSiteButton({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await deleteSiteAction({ id });
      if (result.ok) {
        toast.success('Site removido.');
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Remover ${name}`}>
          <Trash2 className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Remover site</DialogTitle>
          <DialogDescription>
            Remover &quot;{name}&quot;? Jobs e histórico associados deixarão de funcionar.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {pending ? 'Removendo...' : 'Remover'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
