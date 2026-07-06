'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface SourceInfo {
  title: string;
  url: string;
  trusted: boolean;
  extractedContentChars?: number;
}

export interface RunItemView {
  id: string;
  wpPostId: number | null;
  postTitle: string | null;
  status: string;
  action: string | null;
  changesSummary: string | null;
  extractedData: Record<string, unknown> | null;
  rejectedData: Array<{ value: string; reason: string }> | null;
  droppedData: Array<{ list: string; value: string; reason: string }> | null;
  validationErrors: string[] | null;
  sources: SourceInfo[] | null;
  durationMs: number | null;
}

function DataList({ title, items, tone }: { title: string; items: string[]; tone: 'ok' | 'warn' | 'err' }) {
  if (items.length === 0) return null;
  const toneClass =
    tone === 'ok'
      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
      : tone === 'warn'
        ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
        : 'bg-red-500/10 text-red-700 dark:text-red-400';
  return (
    <div>
      <p className="text-muted-foreground mb-1 text-xs font-medium uppercase tracking-wide">{title}</p>
      <div className="flex flex-wrap gap-1">
        {items.map((item, i) => (
          <span key={i} className={cn('max-w-full break-all rounded px-1.5 py-0.5 font-mono text-xs', toneClass)}>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

export function RunItemCard({ item }: { item: RunItemView }) {
  const [open, setOpen] = useState(false);

  const extractedLists = Object.entries(item.extractedData ?? {}).filter(([, v]) => Array.isArray(v)) as Array<
    [string, Array<Record<string, unknown>>]
  >;
  const extractedCount = extractedLists.reduce((acc, [, list]) => acc + list.length, 0);

  return (
    <Card className="min-w-0 overflow-hidden py-0">
      <CardContent className="p-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="hover:bg-muted/50 flex w-full items-center gap-3 px-4 py-3 text-left"
        >
          <ChevronDown className={cn('text-muted-foreground size-4 shrink-0 transition-transform', open && 'rotate-180')} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">
              {item.postTitle ?? `post #${item.wpPostId ?? '?'}`}
              {item.wpPostId ? <span className="text-muted-foreground ml-2 text-xs">#{item.wpPostId}</span> : null}
            </p>
            {item.changesSummary ? (
              <p className="text-muted-foreground truncate text-sm">{item.changesSummary}</p>
            ) : null}
          </div>
          {item.action ? <Badge variant="outline">{item.action}</Badge> : null}
          <StatusBadge status={item.status} />
          {item.durationMs ? (
            <span className="text-muted-foreground text-xs tabular-nums">{(item.durationMs / 1000).toFixed(1)}s</span>
          ) : null}
        </button>
        {open ? (
          <div className="space-y-4 border-t px-4 py-4">
            {item.validationErrors?.length ? (
              <div className="break-words rounded-md bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                <p className="mb-1 font-medium">Bloqueado pela validação:</p>
                <ul className="list-inside list-disc space-y-0.5">
                  {item.validationErrors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {extractedCount > 0
              ? extractedLists.map(([list, items]) => (
                  <DataList
                    key={list}
                    title={`${list} (${items.length})`}
                    tone="ok"
                    items={items.map((it) => String(it.code ?? it.value ?? JSON.stringify(it)))}
                  />
                ))
              : null}
            <DataList
              title="Rejeitados pela verificação IA"
              tone="warn"
              items={(item.rejectedData ?? []).map((r) => `${r.value} — ${r.reason}`)}
            />
            <DataList
              title="Dropados pela checagem verbatim"
              tone="err"
              items={(item.droppedData ?? []).map((d) => `${d.value} — ${d.reason}`)}
            />
            {item.sources?.length ? (
              <div>
                <p className="text-muted-foreground mb-1 text-xs font-medium uppercase tracking-wide">
                  Fontes ({item.sources.length})
                </p>
                <ul className="space-y-1">
                  {item.sources.map((s, i) => (
                    <li key={i} className="flex min-w-0 items-center gap-2 text-sm">
                      {s.trusted ? (
                        <Badge variant="secondary" className="shrink-0 bg-emerald-500/15 text-[10px] text-emerald-700 dark:text-emerald-400">
                          confiável
                        </Badge>
                      ) : null}
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-muted-foreground min-w-0 flex-1 truncate hover:underline"
                      >
                        {s.title || s.url}
                      </a>
                      {typeof s.extractedContentChars === 'number' && s.extractedContentChars > 0 ? (
                        <span className="text-muted-foreground shrink-0 text-xs">
                          {Math.round(s.extractedContentChars / 1000)}k chars
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
