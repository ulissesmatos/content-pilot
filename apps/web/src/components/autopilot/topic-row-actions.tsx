'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { dismissTopicAction, generateTopicNowAction } from '@/actions/autopilot';
import { Button } from '@/components/ui/button';
import { useRunTracker } from '@/components/runs/run-tracker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** Ações de um tema pendente do feed: gerar a pauta agora ou descartar. */
export function TopicRowActions({ topicId, topic }: { topicId: string; topic: string }) {
  const t = useTranslations('autopilot');
  const router = useRouter();
  const { track } = useRunTracker();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await generateTopicNowAction({ id: topicId });
            if (result.ok) {
              track(result.data.runId);
            } else {
              toast.error(result.error);
            }
          })
        }
      >
        <Sparkles className="size-4" />
        {pending ? t('topicGenerating') : t('topicGenerate')}
      </Button>
      <Button variant="ghost" size="icon" aria-label={t('topicDismiss')} onClick={() => setConfirmOpen(true)}>
        <X className="size-4" />
      </Button>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('topicDismissTitle')}</DialogTitle>
            <DialogDescription>{t('topicDismissDescription', { topic })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={pending}>
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await dismissTopicAction({ id: topicId });
                  if (result.ok) {
                    toast.success(t('topicDismissed'));
                    setConfirmOpen(false);
                    router.refresh();
                  } else {
                    toast.error(result.error);
                  }
                })
              }
            >
              {pending ? t('topicDismissing') : t('topicDismiss')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
