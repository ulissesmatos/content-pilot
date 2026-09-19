/** fetch com timeout e retry com backoff — mesmo comportamento dos nós HTTP do workflow (3 tentativas, 5s). */

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface FetchRetryOptions {
  timeoutMs?: number;
  /** Tentativas no total, não tentativas adicionais. */
  retries?: number;
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 5xx, 408 e 429 podem mudar de resposta; o resto dos 4xx não. */
function isRetryableStatus(status: number): boolean {
  if (status === 408 || status === 429) return true;
  return status >= 500;
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: FetchRetryOptions = {},
): Promise<Response> {
  const { timeoutMs = 60_000, retries = 3, retryDelayMs = 5_000, fetchImpl = fetch } = opts;

  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return res;
      const body = await res.text().catch(() => '');
      throw new HttpError(`HTTP ${res.status} em ${url}`, res.status, body.slice(0, 2000));
    } catch (err) {
      lastError = err;
      // A decisão de repetir fica AQUI, e não junto do `throw` acima: lançar
      // dentro do try cai neste mesmo catch, então um 4xx definitivo seria
      // repetido do mesmo jeito. Erro de rede e timeout não são HttpError e
      // continuam valendo nova tentativa.
      const definitive = err instanceof HttpError && !isRetryableStatus(err.status);
      if (definitive || attempt === retries) throw err;
    }
    await sleep(retryDelayMs);
  }
  throw lastError;
}
