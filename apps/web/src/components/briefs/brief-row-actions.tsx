'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Globe, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { deleteBriefAction, publishBriefAction, regenerateBriefAction } from '@/actions/briefs';
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

export function RegenerateBriefButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await regenerateBriefAction({ id });
          if (result.ok) {
            toast.success('Regeração iniciada.');
            router.push(`/runs/${result.data.runId}`);
          } else {
            toast.error(result.error);
          }
        })
      }
    >
      <RotateCcw className="size-4" />
      {pending ? 'Enviando...' : 'Regerar'}
    </Button>
  );
}

export function PublishBriefButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Globe className="size-4" />
          Publicar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Publicar no site</DialogTitle>
          <DialogDescription>
            O rascunho ficará visível publicamente no WordPress. Revise o conteúdo antes.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await publishBriefAction({ id });
                if (result.ok) {
                  toast.success('Post publicado no site.');
                  setOpen(false);
                } else {
                  toast.error(result.error);
                }
              })
            }
          >
            {pending ? 'Publicando...' : 'Publicar agora'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteBriefButton({ id, topic }: { id: string; topic: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Excluir ${topic}`}>
          <Trash2 className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Excluir pauta</DialogTitle>
          <DialogDescription>
            Excluir &quot;{topic}&quot;? O post criado no WordPress (se houver) não é afetado.
          </DialogDescription>
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
                const result = await deleteBriefAction({ id });
                if (result.ok) {
                  toast.success('Pauta excluída.');
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
