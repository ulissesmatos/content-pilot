'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Terminal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface RunLogLine {
  id: number;
  ts: string; // ISO
  line: string;
}

/**
 * Log de execução persistido (run_logs). Colapsável; aberto por padrão quando
 * a run está em andamento ou falhou. Auto-scroll para o fim enquanto roda —
 * o AutoRefresh da página re-renderiza com as linhas novas.
 */
export function RunLog({ lines, defaultOpen }: { lines: RunLogLine[]; defaultOpen: boolean }) {
  const t = useTranslations('runDetail');
  const [open, setOpen] = useState(defaultOpen);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (open && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [open, lines.length]);

  return (
    <Card className="min-w-0 overflow-hidden py-0">
      <CardContent className="p-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="hover:bg-muted/50 flex w-full items-center gap-3 px-4 py-3 text-left"
        >
          <ChevronDown className={cn('text-muted-foreground size-4 shrink-0 transition-transform', open && 'rotate-180')} />
          <Terminal className="text-muted-foreground size-4 shrink-0" />
          <span className="font-medium">{t('log')}</span>
          <span className="text-muted-foreground text-xs tabular-nums">{lines.length}</span>
        </button>
        {open ? (
          lines.length === 0 ? (
            <p className="text-muted-foreground border-t px-4 py-4 text-sm">{t('logEmpty')}</p>
          ) : (
            <pre
              ref={preRef}
              className="bg-muted/30 max-h-96 overflow-auto border-t px-4 py-3 font-mono text-xs leading-5"
            >
              {lines.map((l) => (
                <div key={l.id} className="flex gap-2">
                  <span className="text-muted-foreground shrink-0 tabular-nums">
                    {new Date(l.ts).toLocaleTimeString('en-GB', { hour12: false })}
                  </span>
                  <span className="whitespace-pre-wrap break-all">{l.line}</span>
                </div>
              ))}
            </pre>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
