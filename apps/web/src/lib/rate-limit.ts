/**
 * Rate limit de login em memória (anti brute-force). Suficiente para uma
 * instância única do painel; com múltiplas réplicas, trocar por Redis/DB.
 * Janela deslizante: MAX_FAILURES falhas por WINDOW_MS bloqueiam a chave.
 */

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

interface Entry {
  failures: number[];
}

const attempts = new Map<string, Entry>();

function prune(entry: Entry, now: number) {
  entry.failures = entry.failures.filter((t) => now - t < WINDOW_MS);
}

/** true = pode tentar; false = bloqueado pela janela atual. */
export function checkLoginRateLimit(key: string): boolean {
  const entry = attempts.get(key);
  if (!entry) return true;
  prune(entry, Date.now());
  return entry.failures.length < MAX_FAILURES;
}

export function registerLoginFailure(key: string): void {
  const now = Date.now();
  const entry = attempts.get(key) ?? { failures: [] };
  prune(entry, now);
  entry.failures.push(now);
  attempts.set(key, entry);
  // higiene: não deixa o mapa crescer sem limite
  if (attempts.size > 10_000) {
    for (const [k, e] of attempts) {
      prune(e, now);
      if (e.failures.length === 0) attempts.delete(k);
    }
  }
}

export function registerLoginSuccess(key: string): void {
  attempts.delete(key);
}
