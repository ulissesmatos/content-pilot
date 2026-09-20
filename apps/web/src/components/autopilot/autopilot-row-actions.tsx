'use client';

/** Mesmo motivo que o servidor devolve — aqui só evita o clique inútil. */
const BLOCKED_HINT = 'Configuração incompleta: veja o aviso no topo da página.';

import { useState, useTransition } from 'react';
import { Sparkles, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { deleteAutopilotAction, runAutopilotNowAction, toggleAutopilotAction } from '@/actions/autopilot';
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
import { useRunTracker } from '@/components/runs/run-tracker';

export function AutopilotEnabledSwitch({ id, enabled }: { id: string; enabled: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <Switch
      checked={enabled}
      disabled={pending}
      onCheckedChange={(next) =>
        startTransition(async () => {
          const result = await toggleAutopilotAction({ id, enabled: next });
          if (!result.ok) toast.error(result.error);
        })
      }
    />
  );
}

export function RunDiscoveryButton({ id, blocked = false }: { id: string; blocked?: boolean }) {
  const t = useTranslations('autopilot');
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
          const result = await runAutopilotNowAction({ id });
          if (result.ok) {
            // painel ao vivo, que segue a descoberta até os posts que ela gera
            track(result.data.runId);
          } else {
            toast.error(result.error);
          }
        })
      }
    >
      <Sparkles className="size-4" />
      {pending ? t('starting') : t('discoverNow')}
    </Button>
  );
}

export function DeleteAutopilotButton({ id, name }: { id: string; name: string }) {
  const t = useTranslations('autopilot');
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
                const result = await deleteAutopilotAction({ id });
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
