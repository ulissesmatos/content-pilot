import { PenLine, RefreshCw, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Distinção visual entre os fluxos de conteúdo do sistema:
 * atualização de posts (azul) × criação de posts (violeta) × descoberta
 * do Autopilot (âmbar). As mesmas cores aparecem nos pontos da sidebar.
 * Textos no catálogo i18n (namespace `runType`).
 */
const TYPE_STYLES = {
  update: {
    icon: RefreshCw,
    className: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
  },
  create: {
    icon: PenLine,
    className: 'bg-violet-500/15 text-violet-700 dark:text-violet-400',
  },
  discover: {
    icon: Sparkles,
    className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  },
} as const;

export type RunType = keyof typeof TYPE_STYLES;

export function RunTypeBadge({ type }: { type: RunType }) {
  const t = useTranslations('runType');
  const style = TYPE_STYLES[type];
  const Icon = style.icon;
  return (
    <Badge variant="secondary" className={cn('gap-1 border-transparent', style.className)}>
      <Icon className="size-3" />
      {t(type)}
    </Badge>
  );
}
