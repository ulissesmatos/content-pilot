'use client';

import { useState, useTransition } from 'react';
import { Globe, RotateCcw, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { deleteBriefAction, publishBriefAction, regenerateBriefAction } from '@/actions/briefs';
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

export function RegenerateBriefButton({ id }: { id: string }) {
  const t = useTranslations('briefs');
  const { track } = useRunTracker();
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
            track(result.data.runId);
          } else {
            toast.error(result.error);
          }
        })
      }
    >
      <RotateCcw className="size-4" />
      {pending ? t('regenerating') : t('regenerate')}
    </Button>
  );
}

export function PublishBriefButton({ id }: { id: string }) {
  const t = useTranslations('briefs');
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Globe className="size-4" />
          {t('publish')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('publishTitle')}</DialogTitle>
          <DialogDescription>{t('publishDescription')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {t('cancel')}
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await publishBriefAction({ id });
                if (result.ok) {
                  toast.success(t('published'));
                  setOpen(false);
                } else {
                  toast.error(result.error);
                }
              })
            }
          >
            {pending ? t('publishing') : t('publishNow')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteBriefButton({ id, topic }: { id: string; topic: string }) {
  const t = useTranslations('briefs');
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`${t('deleteTitle')}: ${topic}`}>
          <Trash2 className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('deleteTitle')}</DialogTitle>
          <DialogDescription>{t('deleteDescription', { topic })}</DialogDescription>
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
                const result = await deleteBriefAction({ id });
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
