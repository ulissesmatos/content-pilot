'use client';

import { useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { createCheckoutSessionAction, createPortalSessionAction } from '@/actions/billing';
import { Button } from '@/components/ui/button';

export function UpgradeButton({ plan, label, highlight }: { plan: 'starter' | 'pro'; label: string; highlight?: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      className="w-full"
      variant={highlight ? 'default' : 'outline'}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await createCheckoutSessionAction({ plan });
          if (res.ok) window.location.href = res.data.url;
          else toast.error(res.error);
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
    </Button>
  );
}

export function ManageSubscriptionButton({ label }: { label: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await createPortalSessionAction({});
          if (res.ok) window.location.href = res.data.url;
          else toast.error(res.error);
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
    </Button>
  );
}
