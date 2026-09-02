import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * Lista do painel admin em dois layouts, alternados por CSS.
 *
 * Renderiza tabela E cards e deixa o Tailwind escolher (`hidden md:block` /
 * `md:hidden`), em vez de decidir em JS com useIsMobile(). Assim cada página
 * de lista continua sendo um Server Component puro, sem hidratação nem flash.
 *
 * O fallback em card não é enfeite: `ui/table.tsx` põe `whitespace-nowrap` em
 * toda célula, então e-mails e nomes de workspace fazem a tabela rolar na
 * horizontal no celular.
 */

export type ColumnPriority = 'primary' | 'secondary' | 'meta';

export interface DataListColumn<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /**
   * No mobile: `primary` vira o título do card, `secondary` entra num grid
   * de rótulo/valor e `meta` vai para o rodapé discreto. Padrão: secondary.
   */
  priority?: ColumnPriority;
  /** No grid do mobile, ocupa a linha inteira (conteúdo largo: JSON, URL). */
  fullWidth?: boolean;
  /** Classes da célula na tabela (desktop). */
  className?: string;
  /** Classes do cabeçalho na tabela (desktop). */
  headClassName?: string;
}

export interface DataListProps<T> {
  rows: T[];
  columns: DataListColumn<T>[];
  getKey: (row: T) => string;
  actions?: (row: T) => ReactNode;
}

export function DataList<T>({ rows, columns, getKey, actions }: DataListProps<T>) {
  const byPriority = (p: ColumnPriority) =>
    columns.filter((c) => (c.priority ?? 'secondary') === p);
  const primary = byPriority('primary');
  const secondary = byPriority('secondary');
  const meta = byPriority('meta');

  return (
    <>
      {/* Desktop */}
      <Card className="hidden py-0 md:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((c) => (
                  <TableHead key={c.key} className={c.headClassName}>
                    {c.header}
                  </TableHead>
                ))}
                {actions ? <TableHead className="w-40" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={getKey(row)}>
                  {columns.map((c) => (
                    <TableCell key={c.key} className={c.className}>
                      {c.cell(row)}
                    </TableCell>
                  ))}
                  {actions ? (
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">{actions(row)}</div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Mobile */}
      <div className="space-y-3 md:hidden">
        {rows.map((row) => (
          <Card key={getKey(row)} className="gap-0 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-0.5">
                {primary.map((c) => (
                  <div key={c.key} className="min-w-0 font-medium break-words">
                    {c.cell(row)}
                  </div>
                ))}
              </div>
              {actions ? (
                <div className="flex shrink-0 items-center gap-1">{actions(row)}</div>
              ) : null}
            </div>

            {secondary.length > 0 ? (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {secondary.map((c) => (
                  <div key={c.key} className={c.fullWidth ? 'col-span-2 min-w-0' : 'min-w-0'}>
                    <dt className="text-muted-foreground text-xs">{c.header}</dt>
                    <dd className="min-w-0 break-words">{c.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {meta.length > 0 ? (
              <div className="text-muted-foreground mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t pt-2 text-xs">
                {meta.map((c) => (
                  <span key={c.key} className="min-w-0 break-words">
                    {c.header}: {c.cell(row)}
                  </span>
                ))}
              </div>
            ) : null}
          </Card>
        ))}
      </div>
    </>
  );
}
