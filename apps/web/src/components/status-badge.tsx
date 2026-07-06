import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  // sites
  active: { label: 'Ativo', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  error: { label: 'Erro', className: 'bg-red-500/15 text-red-700 dark:text-red-400' },
  disabled: { label: 'Desativado', className: 'bg-muted text-muted-foreground' },
  // runs
  running: { label: 'Executando', className: 'bg-blue-500/15 text-blue-700 dark:text-blue-400' },
  success: { label: 'Sucesso', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  partial: { label: 'Parcial', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  failed: { label: 'Falhou', className: 'bg-red-500/15 text-red-700 dark:text-red-400' },
  cancelled: { label: 'Cancelado', className: 'bg-muted text-muted-foreground' },
  // run items
  updated: { label: 'Atualizado', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  created: { label: 'Criado', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  no_change: { label: 'Sem mudança', className: 'bg-muted text-muted-foreground' },
  skipped_sources_unchanged: {
    label: 'Fontes inalteradas',
    className: 'bg-muted text-muted-foreground',
  },
  validation_failed: { label: 'Validação falhou', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  llm_failed: { label: 'LLM falhou', className: 'bg-red-500/15 text-red-700 dark:text-red-400' },
  wp_failed: { label: 'WP falhou', className: 'bg-red-500/15 text-red-700 dark:text-red-400' },
  budget_exceeded: { label: 'Orçamento excedido', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  // briefs
  pending: { label: 'Pendente', className: 'bg-muted text-muted-foreground' },
  queued: { label: 'Na fila', className: 'bg-blue-500/15 text-blue-700 dark:text-blue-400' },
  generating: { label: 'Gerando', className: 'bg-blue-500/15 text-blue-700 dark:text-blue-400' },
  ready_for_review: { label: 'Revisar', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  published: { label: 'Publicado', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? { label: status, className: 'bg-muted text-muted-foreground' };
  return (
    <Badge variant="secondary" className={cn('border-transparent', style.className)}>
      {style.label}
    </Badge>
  );
}
