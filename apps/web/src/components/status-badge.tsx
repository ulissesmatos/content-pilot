import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** Cor por status; o texto vem do catálogo i18n (namespace `status`). */
const STATUS_CLASSES: Record<string, string> = {
  // sites
  active: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  error: 'bg-red-500/15 text-red-700 dark:text-red-400',
  disabled: 'bg-muted text-muted-foreground',
  // runs
  running: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  partial: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  failed: 'bg-red-500/15 text-red-700 dark:text-red-400',
  cancelled: 'bg-muted text-muted-foreground',
  // run items
  updated: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  created: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  no_change: 'bg-muted text-muted-foreground',
  skipped_sources_unchanged: 'bg-muted text-muted-foreground',
  validation_failed: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  llm_failed: 'bg-red-500/15 text-red-700 dark:text-red-400',
  wp_failed: 'bg-red-500/15 text-red-700 dark:text-red-400',
  budget_exceeded: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  // briefs
  pending: 'bg-muted text-muted-foreground',
  queued: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  generating: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  ready_for_review: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  published: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  // discovered topics
  discarded_duplicate: 'bg-muted text-muted-foreground',
  discarded_low_value: 'bg-muted text-muted-foreground',
  dismissed: 'bg-muted text-muted-foreground',
  // llm calls
  ok: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  truncated: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
};

export function StatusBadge({ status }: { status: string }) {
  const t = useTranslations('status');
  const className = STATUS_CLASSES[status] ?? 'bg-muted text-muted-foreground';
  const label = t.has(status as never) ? t(status as never) : status;
  return (
    <Badge variant="secondary" className={cn('border-transparent', className)}>
      {label}
    </Badge>
  );
}
