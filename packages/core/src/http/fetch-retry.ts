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
  retries?: number;
  retryDelayMs?: number;
  /** Não faz retry nesses status (padrão: 4xx exceto 408/429). */
  fetchImpl?: typeof fetch;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
      const err = new HttpError(`HTTP ${res.status} em ${url}`, res.status, body.slice(0, 2000));
      if (!isRetryableStatus(res.status) || attempt === retries) throw err;
      lastError = err;
    } catch (err) {
      if (err instanceof HttpError) {
        if (attempt === retries) throw err;
        lastError = err;
      } else {
        // erro de rede/timeout
        if (attempt === retries) throw err;
        lastError = err;
      }
    }
    await sleep(retryDelayMs);
  }
  throw lastError;
}
