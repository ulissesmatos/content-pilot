'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Square } from 'lucide-react';
import { toast } from 'sonner';
import { cancelRunAction } from '@/actions/runs';
import { Button } from '@/components/ui/button';

export function StopRunButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="destructive"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await cancelRunAction({ id: runId });
          if (result.ok) {
            toast.success(
              result.data.cancelledQueued > 0
                ? `Execução parada — ${result.data.cancelledQueued} item(ns) pendente(s) cancelado(s). O post em andamento termina e é descartado.`
                : 'Execução parada.',
            );
            router.refresh();
          } else {
            toast.error(result.error);
          }
        })
      }
    >
      <Square className="size-4" />
      {pending ? 'Parando...' : 'Parar execução'}
    </Button>
  );
}
