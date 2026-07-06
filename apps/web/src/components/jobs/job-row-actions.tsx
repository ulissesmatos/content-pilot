'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Play, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { deleteJobAction, runJobNowAction, toggleJobAction } from '@/actions/jobs';
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
import { Switch } from '@/components/ui/switch';

export function JobEnabledSwitch({ id, enabled }: { id: string; enabled: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <Switch
      checked={enabled}
      disabled={pending}
      onCheckedChange={(next) =>
        startTransition(async () => {
          const result = await toggleJobAction({ id, enabled: next });
          if (!result.ok) toast.error(result.error);
        })
      }
    />
  );
}

export function RunNowButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await runJobNowAction({ id });
          if (result.ok) {
            toast.success('Execução iniciada.');
            router.push(`/runs/${result.data.runId}`);
          } else {
            toast.error(result.error);
          }
        })
      }
    >
      <Play className="size-4" />
      {pending ? 'Iniciando...' : 'Executar agora'}
    </Button>
  );
}

export function DeleteJobButton({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Excluir ${name}`}>
          <Trash2 className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Excluir job</DialogTitle>
          <DialogDescription>Excluir &quot;{name}&quot;? O histórico de execuções é mantido.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await deleteJobAction({ id });
                if (result.ok) {
                  toast.success('Job excluído.');
                  setOpen(false);
                } else {
                  toast.error(result.error);
                }
              })
            }
          >
            {pending ? 'Excluindo...' : 'Excluir'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
