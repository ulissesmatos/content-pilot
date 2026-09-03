import { eq } from 'drizzle-orm';
import type { Db, Tx } from './client';
import { platformSettings } from './schema';

/**
 * Cache de configuração da plataforma, compartilhado por web e worker.
 *
 * O problema: o worker é um processo longevo. Reler planos, perfis de modelo
 * e settings a cada job é desperdício; nunca reler significa servir config de
 * semanas atrás.
 *
 * A solução: TTL curto + um carimbo de versão. Ao expirar o TTL, em vez de
 * recarregar tudo, lemos só a chave `__version` — uma consulta por PK. Se o
 * carimbo não mudou, o valor em memória é revalidado sem novo carregamento.
 * Toda mutação administrativa chama `bumpConfigVersion` na mesma transação.
 *
 * Não usamos LISTEN/NOTIFY de propósito: o pg-boss é dono do pool e uma
 * conexão dedicada só para isso é superfície de falha extra para uma config
 * que muda poucas vezes por mês. 30s de defasagem num limite é inofensivo;
 * um listener morto servindo plano velho em silêncio não é.
 */

const VERSION_KEY = '__version';
const TTL_MS = 30_000;

interface Entry {
  value: unknown;
  expiresAt: number;
  version: string;
}

const entries = new Map<string, Entry>();
let cachedVersion: string | null = null;
let versionCheckedAt = 0;

/** Esquece tudo — usado após uma escrita no próprio processo. */
export function invalidateConfigCache(): void {
  entries.clear();
  cachedVersion = null;
  versionCheckedAt = 0;
}

async function currentVersion(db: Db, now: number): Promise<string> {
  if (cachedVersion !== null && now - versionCheckedAt < TTL_MS) return cachedVersion;
  const [row] = await db
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(eq(platformSettings.key, VERSION_KEY))
    .limit(1);
  cachedVersion = String((row?.value as { v?: unknown } | undefined)?.v ?? '0');
  versionCheckedAt = now;
  return cachedVersion;
}

/**
 * Lê `key` do cache, carregando com `load` quando o carimbo de versão mudou.
 * `load` é chamado no máximo uma vez por mudança de versão por processo.
 */
export async function cachedConfig<T>(db: Db, key: string, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = entries.get(key);
  if (hit && now < hit.expiresAt) return hit.value as T;

  const version = await currentVersion(db, now);
  if (hit && hit.version === version) {
    // nada mudou na plataforma: renova a validade sem recarregar
    hit.expiresAt = now + TTL_MS;
    return hit.value as T;
  }

  const value = await load();
  entries.set(key, { value, expiresAt: now + TTL_MS, version });
  return value;
}

/**
 * Marca a config como alterada. Chamar DENTRO da transação da mutação: se ela
 * der rollback, o carimbo volta junto e ninguém invalida cache à toa.
 */
export async function bumpConfigVersion(tx: Db | Tx): Promise<void> {
  const next = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await tx
    .insert(platformSettings)
    .values({ key: VERSION_KEY, value: { v: next } })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: { value: { v: next }, updatedAt: new Date() },
    });
  // o processo que escreveu enxerga na hora; os demais, em até TTL_MS
  invalidateConfigCache();
}
