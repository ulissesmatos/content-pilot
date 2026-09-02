'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Square } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { cancelRunAction } from '@/actions/runs';
import { Button } from '@/components/ui/button';

export function StopRunButton({ runId }: { runId: string }) {
  const t = useTranslations('runDetail');
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
                ? t('stoppedWithQueued', { count: result.data.cancelledQueued })
                : t('stopped'),
            );
            router.refresh();
          } else {
            toast.error(result.error);
          }
        })
      }
    >
      <Square className="size-4" />
      {pending ? t('stopping') : t('stopRun')}
    </Button>
  );
}
