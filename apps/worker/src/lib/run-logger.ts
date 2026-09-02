import { runLogs, type Db } from '@content-pilot/db';

/**
 * Logger de execução: cada linha vai para o console (comportamento antigo) e
 * para um buffer que é gravado em run_logs em lote — o detalhe da run no
 * painel mostra o passo a passo em quase tempo real. Persistência é
 * best-effort: falha de flush nunca derruba o handler.
 */

const FLUSH_AT = 20; // linhas
const FLUSH_MS = 3_000;
const MAX_LINE = 4_000;

export interface RunLogger {
  log: (msg: string) => void;
  /** Grava o que restou no buffer. Chamar em try/finally no fim do handler. */
  flush: () => Promise<void>;
}

export function createRunLogger(db: Db, runId: string, consolePrefix = ''): RunLogger {
  let buffer: Array<{ ts: Date; line: string }> = [];
  let timer: NodeJS.Timeout | null = null;
  let inflight: Promise<void> = Promise.resolve();

  const flush = (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    // serializa flushes: o próximo só roda quando o anterior terminar
    inflight = inflight.then(async () => {
      if (buffer.length === 0) return;
      const batch = buffer;
      buffer = [];
      try {
        await db.insert(runLogs).values(batch.map((b) => ({ runId, ts: b.ts, line: b.line })));
      } catch (err) {
        console.warn(`[run-logger] flush falhou (${batch.length} linha(s) perdidas): ${err instanceof Error ? err.message : err}`);
      }
    });
    return inflight;
  };

  return {
    log(msg: string) {
      const line = String(msg).slice(0, MAX_LINE);
      console.log(consolePrefix ? `${consolePrefix} ${line}` : line);
      buffer.push({ ts: new Date(), line });
      if (buffer.length >= FLUSH_AT) {
        void flush();
      } else if (!timer) {
        timer = setTimeout(() => void flush(), FLUSH_MS);
        timer.unref?.();
      }
    },
    flush,
  };
}
