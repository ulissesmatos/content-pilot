import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Paginação por querystring — links de verdade, então funciona em Server
 * Component e o estado vive na URL (compartilhável, sobrevive ao refresh).
 */
export function Pager({
  page,
  hasNext,
  basePath,
  params = {},
  total,
}: {
  /** 1-based. */
  page: number;
  hasNext: boolean;
  basePath: string;
  /** Filtros atuais, preservados ao trocar de página. */
  params?: Record<string, string | undefined>;
  total?: number;
}) {
  const href = (target: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v) q.set(k, v);
    }
    if (target > 1) q.set('page', String(target));
    const qs = q.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const hasPrev = page > 1;
  if (!hasPrev && !hasNext) return null;

  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-muted-foreground text-sm">
        Página {page}
        {typeof total === 'number' ? ` · ${total} no total` : ''}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" asChild={hasPrev} disabled={!hasPrev}>
          {hasPrev ? (
            <Link href={href(page - 1)}>
              <ChevronLeft className="size-4" />
              Anterior
            </Link>
          ) : (
            <span>
              <ChevronLeft className="size-4" />
              Anterior
            </span>
          )}
        </Button>
        <Button variant="outline" size="sm" asChild={hasNext} disabled={!hasNext}>
          {hasNext ? (
            <Link href={href(page + 1)}>
              Próxima
              <ChevronRight className="size-4" />
            </Link>
          ) : (
            <span>
              Próxima
              <ChevronRight className="size-4" />
            </span>
          )}
        </Button>
      </div>
    </div>
  );
}
