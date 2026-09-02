'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { History, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { restoreRunItemAction, retryRunItemAction } from '@/actions/runs';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** Reprocessa um item falhado de run de atualização: cria run novo e navega para ele. */
export function RetryItemButton({ runItemId }: { runItemId: string }) {
  const t = useTranslations('runDetail');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await retryRunItemAction({ id: runItemId });
          if (result.ok) {
            toast.success(t('retryQueued'));
            router.push(`/runs/${result.data.runId}`);
          } else {
            toast.error(result.error);
          }
        })
      }
    >
      <RotateCcw className="size-4" />
      {pending ? t('retrying') : t('retry')}
    </Button>
  );
}

/** Restaura no WP o conteúdo de antes da execução (com confirmação). */
export function RestoreItemButton({ runItemId, wpPostId }: { runItemId: string; wpPostId: number }) {
  const t = useTranslations('runDetail');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <History className="size-4" />
        {t('restore')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('restoreConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('restoreConfirmDescription', { wpPostId })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await restoreRunItemAction({ id: runItemId });
                  if (result.ok) {
                    toast.success(t('restored'));
                    setOpen(false);
                    router.refresh();
                  } else {
                    toast.error(result.error);
                  }
                })
              }
            >
              {pending ? t('restoring') : t('restoreConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
