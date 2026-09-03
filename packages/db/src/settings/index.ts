import { eq } from 'drizzle-orm';
import type { Db, Tx } from '../client';
import { platformSettings } from '../schema';
import { bumpConfigVersion, cachedConfig } from '../config-cache';

/**
 * Leitura/escrita da config não-secreta da plataforma.
 *
 * O parser é recebido como interface mínima (`safeParse`) em vez de um tipo
 * do zod: assim `packages/db` não precisa depender de zod, e quem chama passa
 * o schema do core normalmente.
 */
interface Parser<T> {
  safeParse: (value: unknown) => { success: true; data: T } | { success: false };
}

/**
 * Valor da chave, validado. Linha ausente OU conteúdo inválido caem no
 * fallback — uma linha corrompida não pode derrubar o worker.
 */
export async function getSetting<T>(db: Db, key: string, parser: Parser<T>, fallback: T): Promise<T> {
  return cachedConfig(db, `settings:${key}`, async () => {
    const [row] = await db
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(eq(platformSettings.key, key))
      .limit(1);
    if (!row) return fallback;
    const parsed = parser.safeParse(row.value);
    if (!parsed.success) {
      console.warn(`[settings] chave "${key}" inválida no banco — usando o padrão.`);
      return fallback;
    }
    return parsed.data;
  });
}

/** Grava a chave e carimba a versão da config na MESMA transação. */
export async function setSetting(
  tx: Tx,
  key: string,
  value: Record<string, unknown>,
  actorId: string | null,
): Promise<void> {
  await tx
    .insert(platformSettings)
    .values({ key, value, updatedBy: actorId })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: { value, updatedBy: actorId, updatedAt: new Date() },
    });
  await bumpConfigVersion(tx);
}
