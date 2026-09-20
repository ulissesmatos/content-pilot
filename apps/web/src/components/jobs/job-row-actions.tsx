'use client';

/** Mesmo motivo que o servidor devolve — aqui só evita o clique inútil. */
const BLOCKED_HINT = 'Configuração incompleta: veja o aviso no topo da página.';

import { useState, useTransition } from 'react';
import { Play, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { deleteJobAction, runJobNowAction, toggleJobAction } from '@/actions/jobs';
import { Button } from '@/components/ui/button';
import { useRunTracker } from '@/components/runs/run-tracker';
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

export function RunNowButton({ id, blocked = false }: { id: string; blocked?: boolean }) {
  const t = useTranslations('jobs');
  const { track } = useRunTracker();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending || blocked}
      title={blocked ? BLOCKED_HINT : undefined}
      onClick={() =>
        startTransition(async () => {
          const result = await runJobNowAction({ id });
          if (result.ok) {
            track(result.data.runId);
          } else {
            toast.error(result.error);
          }
        })
      }
    >
      <Play className="size-4" />
      {pending ? t('starting') : t('runNow')}
    </Button>
  );
}

export function DeleteJobButton({ id, name }: { id: string; name: string }) {
  const t = useTranslations('jobs');
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`${t('deleteTitle')}: ${name}`}>
          <Trash2 className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('deleteTitle')}</DialogTitle>
          <DialogDescription>{t('deleteDescription', { name })}</DialogDescription>
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
                const result = await deleteJobAction({ id });
                if (result.ok) {
                  toast.success(t('deleted'));
                  setOpen(false);
                } else {
                  toast.error(result.error);
                }
              })
            }
          >
            {pending ? t('deleting') : t('deleteConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
