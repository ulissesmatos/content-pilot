import { credentials, eq, type Db } from '@content-pilot/db';

/**
 * Grava o último uso REAL de uma credencial (`credentials.last_used_at`), que a tela
 * /credentials mostra. É chamado quando o provedor aceitou uma chamada (ver `trackUsage`).
 *
 * No máximo uma gravação por minuto por credencial e por processo: um artigo faz dezenas de
 * chamadas com a mesma chave, e o minuto é a precisão que a tela precisa.
 */

const MIN_INTERVAL_MS = 60_000;
const lastTouched = new Map<string, number>();

/** Só para testes: esquece o que já foi gravado. */
export function resetCredentialUsageThrottle(): void {
  lastTouched.clear();
}

export function touchCredential(db: Db, credentialId: string, now: number = Date.now()): Promise<void> {
  const prev = lastTouched.get(credentialId);
  if (prev !== undefined && now - prev < MIN_INTERVAL_MS) return Promise.resolve();
  lastTouched.set(credentialId, now);
  const failed = (err: unknown) => {
    // best-effort: falhar em anotar o uso não pode atrapalhar a geração
    console.warn(`[credential-usage] não gravou o uso da credencial ${credentialId}: ${err instanceof Error ? err.message : err}`);
    lastTouched.delete(credentialId);
  };
  try {
    return db
      .update(credentials)
      .set({ lastUsedAt: new Date(now) })
      .where(eq(credentials.id, credentialId))
      .then(() => undefined, failed);
  } catch (err) {
    failed(err);
    return Promise.resolve();
  }
}
