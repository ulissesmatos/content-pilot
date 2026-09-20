'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Circle, ExternalLink, FileText, Loader2, Minus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { RunProgress, ProgressPost } from '@/lib/run-progress';

/**
 * Acompanhamento ao vivo de uma execução, em qualquer tela.
 *
 * Antes cada botão fazia `router.push('/runs/<id>')`. Para "Descobrir agora" isso
 * abria o run da DESCOBERTA, que termina em segundos, enquanto o post era gerado
 * em runs filhos que ninguém via. Aqui um painel único, aberto por `track(runId)`,
 * segue a execução até o último post que ela gerou e termina com os dois botões
 * que importam: abrir no WordPress e abrir no sistema para revisar e publicar.
 */

interface RunTracker {
  track: (runId: string) => void;
}
const Ctx = createContext<RunTracker | null>(null);

export function useRunTracker(): RunTracker {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useRunTracker precisa do RunTrackerProvider');
  return ctx;
}

const POLL_MS = 1500;
/** Depois disto sem conseguir falar com o servidor, avisa em vez de girar para sempre. */
const MAX_CONSECUTIVE_ERRORS = 8;

type Load =
  | { state: 'loading' }
  | { state: 'ok'; data: RunProgress }
  | { state: 'error'; reason: 'unauthorized' | 'not_found' | 'network' };

function useRunProgress(runId: string | null): Load {
  // O resultado guarda a que run pertence. "Carregando" é derivado: se o run atual
  // não é o do resultado guardado, ainda não chegou nada dele. Assim trocar de run
  // não exige zerar o estado dentro do efeito (o que causaria render em cascata).
  const [loaded, setLoaded] = useState<{ runId: string; load: Load } | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!runId) return;
    const setLoad = (load: Load) => setLoaded({ runId, load });
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let errors = 0;

    const tick = async () => {
      try {
        const res = await fetch(`/api/runs/${runId}/progress`, { cache: 'no-store' });
        if (cancelled) return;
        if (res.status === 401) return setLoad({ state: 'error', reason: 'unauthorized' });
        if (res.status === 404) return setLoad({ state: 'error', reason: 'not_found' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as RunProgress;
        errors = 0;
        setLoad({ state: 'ok', data });
        if (data.done) {
          // as listas do painel por trás (pautas, execuções) passam a ter o resultado
          router.refresh();
          return;
        }
      } catch {
        errors++;
        if (errors >= MAX_CONSECUTIVE_ERRORS) return setLoad({ state: 'error', reason: 'network' });
      }
      timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, router]);

  return loaded && loaded.runId === runId ? loaded.load : { state: 'loading' };
}

export function RunTrackerProvider({ children }: { children: ReactNode }) {
  const [runId, setRunId] = useState<string | null>(null);
  const track = useCallback((id: string) => setRunId(id), []);
  const value = useMemo(() => ({ track }), [track]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <TrackerDialog runId={runId} onClose={() => setRunId(null)} />
    </Ctx.Provider>
  );
}

function StageIcon({ status }: { status: string }) {
  if (status === 'done') return <Check className="size-4 text-emerald-600" aria-hidden />;
  if (status === 'active') return <Loader2 className="text-primary size-4 animate-spin" aria-hidden />;
  if (status === 'failed') return <X className="text-destructive size-4" aria-hidden />;
  if (status === 'skipped') return <Minus className="text-muted-foreground size-4" aria-hidden />;
  return <Circle className="text-muted-foreground/50 size-4" aria-hidden />;
}

function Stepper({ stages }: { stages: Array<{ key: string; label: string; status: string }> }) {
  const t = useTranslations('tracker');
  return (
    <ol className="space-y-1.5">
      {stages.map((s) => (
        <li
          key={s.key}
          className={`flex items-center gap-2 text-sm ${
            s.status === 'pending' || s.status === 'skipped' ? 'text-muted-foreground' : 'text-foreground'
          } ${s.status === 'active' ? 'font-medium' : ''}`}
        >
          <StageIcon status={s.status} />
          <span>{s.label}</span>
          {s.status === 'skipped' ? <span className="text-xs">({t('skipped')})</span> : null}
        </li>
      ))}
    </ol>
  );
}

function ProgressBar({ value, failed }: { value: number; failed?: boolean }) {
  return (
    <div
      className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full rounded-full transition-all duration-500 ${failed ? 'bg-destructive' : 'bg-primary'}`}
        style={{ width: `${Math.max(value, 3)}%` }}
      />
    </div>
  );
}

function LogConsole({ lines, defaultOpen = false }: { lines: Array<{ ts: string; line: string }>; defaultOpen?: boolean }) {
  const t = useTranslations('tracker');
  const [open, setOpen] = useState(defaultOpen);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: 'end' });
  }, [open, lines.length]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        {open ? t('hideLog') : t('showLog', { count: lines.length })}
      </button>
      {open ? (
        <div className="bg-muted/60 mt-2 max-h-56 overflow-auto rounded-md p-3 font-mono text-xs leading-relaxed">
          {lines.length === 0 ? (
            <span className="text-muted-foreground">{t('logEmpty')}</span>
          ) : (
            lines.map((l, i) => (
              <div key={i} className={l.line.startsWith('etapa: ') ? 'text-primary mt-1 font-semibold' : 'break-words'}>
                {l.line}
              </div>
            ))
          )}
          <div ref={endRef} />
        </div>
      ) : null}
    </div>
  );
}

/** Um post sendo gerado: etapas, log e, no fim, os dois botões. */
function PostCard({ post, compact }: { post: ProgressPost; compact?: boolean }) {
  const t = useTranslations('tracker');
  const finished = post.runStatus !== 'running';
  const failed = post.runStatus === 'failed' || post.runStatus === 'cancelled' || post.briefStatus === 'failed';

  return (
    <div className={compact ? 'space-y-3 rounded-lg border p-4' : 'space-y-4'}>
      {compact ? <p className="text-sm font-medium leading-snug">{post.topic}</p> : null}
      <ProgressBar value={post.progress} failed={failed} />
      <Stepper stages={post.stages} />

      {failed && post.error ? (
        <div className="bg-destructive/10 text-destructive flex gap-2 rounded-md p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="break-words">{post.error}</span>
        </div>
      ) : null}

      {finished && !failed ? (
        <div className="flex flex-wrap gap-2 pt-1">
          {post.wpUrl ? (
            <Button asChild variant="outline" size="sm">
              <a href={post.wpUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" />
                {t('openWp')}
              </a>
            </Button>
          ) : null}
          <Button asChild size="sm">
            <Link href={`/briefs/${post.briefId}`}>
              <FileText className="size-4" />
              {t('openSystem')}
            </Link>
          </Button>
        </div>
      ) : null}

      <LogConsole lines={post.logs} />
    </div>
  );
}

function TrackerDialog({ runId, onClose }: { runId: string | null; onClose: () => void }) {
  const t = useTranslations('tracker');
  const load = useRunProgress(runId);
  const open = runId !== null;

  const data = load.state === 'ok' ? load.data : null;
  const isDiscover = data?.run.kind === 'discover';
  const single = data && !isDiscover && data.posts.length === 1 ? data.posts[0]! : null;

  // a última linha "falha: ..." do log é o motivo, em texto que o usuário entende
  const failure =
    data?.run.status === 'failed'
      ? (data.run.error ?? [...data.logs].reverse().find((l) => l.line.startsWith('falha: '))?.line.slice(7) ?? null)
      : null;

  const title = isDiscover ? t('titleDiscover') : data?.run.kind === 'create' ? t('titleCreate') : t('title');

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {data?.done
              ? data.run.status === 'failed'
                ? t('doneFailed')
                : t('doneOk')
              : t('running')}
          </DialogDescription>
        </DialogHeader>

        {load.state === 'loading' ? (
          <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
            <Loader2 className="size-4 animate-spin" /> {t('connecting')}
          </div>
        ) : null}

        {load.state === 'error' ? (
          <div className="bg-destructive/10 text-destructive flex gap-2 rounded-md p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{t(`error.${load.reason}`)}</span>
          </div>
        ) : null}

        {data ? (
          <div className="space-y-5">
            {/* descoberta: primeiro a própria busca de temas, depois cada post gerado */}
            {isDiscover ? (
              <>
                <div className="space-y-3">
                  <ProgressBar value={data.progress} failed={data.run.status === 'failed'} />
                  <Stepper stages={data.stages} />
                  {data.run.error ? (
                    <p className="text-destructive text-sm break-words">{data.run.error}</p>
                  ) : null}
                  <LogConsole lines={data.logs} />
                </div>
                {data.posts.map((p) => (
                  <PostCard key={p.runId} post={p} compact />
                ))}
                {data.pendingBriefs.length > 0 ? (
                  <div className="bg-muted/50 space-y-1 rounded-md p-3 text-sm">
                    <p className="font-medium">{t('pendingBriefs', { count: data.pendingBriefs.length })}</p>
                    <ul className="text-muted-foreground list-disc pl-5">
                      {data.pendingBriefs.slice(0, 5).map((b) => (
                        <li key={b.briefId}>{b.topic}</li>
                      ))}
                    </ul>
                    <Button asChild variant="link" size="sm" className="h-auto p-0">
                      <Link href="/briefs">{t('goToBriefs')}</Link>
                    </Button>
                  </div>
                ) : null}
                {data.done && data.posts.length === 0 && data.pendingBriefs.length === 0 && data.run.status !== 'failed' ? (
                  <p className="text-muted-foreground text-sm">{t('noNewTopics')}</p>
                ) : null}
              </>
            ) : single ? (
              <PostCard post={single} />
            ) : (
              <>
                {/* execução sem etapas (troca de imagem, atualização): a barra só diz se terminou, e o log já vem aberto */}
                <ProgressBar value={data.done ? 100 : data.progress} failed={data.run.status === 'failed'} />
                {failure ? (
                  <div className="bg-destructive/10 text-destructive flex gap-2 rounded-md p-3 text-sm">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span className="break-words">{failure}</span>
                  </div>
                ) : null}
                <LogConsole lines={data.logs} defaultOpen />
              </>
            )}

            <div className="flex items-center justify-between border-t pt-3">
              <Button asChild variant="link" size="sm" className="text-muted-foreground h-auto p-0">
                <Link href={`/runs/${data.run.id}`}>{t('viewRun')}</Link>
              </Button>
              <Button variant="outline" size="sm" onClick={onClose}>
                {data.done ? t('close') : t('keepInBackground')}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
