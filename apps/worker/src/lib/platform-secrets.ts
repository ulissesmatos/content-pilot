import { and, credentials, desc, eq, isNull, type Db } from '@content-pilot/db';
import { PLATFORM_VAULT_SCOPE } from '@content-pilot/core';
import { decryptSecret } from './vault';

/**
 * Gêmeo só-leitura do apps/web/src/lib/platform-secrets.ts. O worker nunca
 * grava credencial, então não precisa da chave ativa do vault — apenas do
 * conjunto de master keys para decifrar.
 */
export type PlatformSecretType = 'stripe' | 'resend' | 'openai' | 'openrouter' | 'anthropic' | 'tavily';

export async function readPlatformCredential<T extends Record<string, unknown>>(
  db: Db,
  type: PlatformSecretType,
): Promise<T | null> {
  const [row] = await db
    .select({ id: credentials.id, ciphertext: credentials.ciphertext })
    .from(credentials)
    .where(and(isNull(credentials.workspaceId), eq(credentials.type, type)))
    .orderBy(desc(credentials.updatedAt))
    .limit(1);
  if (!row) return null;
  try {
    return decryptSecret<T>(row.ciphertext, PLATFORM_VAULT_SCOPE, row.id);
  } catch (err) {
    console.error(`[platform-secrets] falha ao decifrar credencial ${type}`, err);
    return null;
  }
}
