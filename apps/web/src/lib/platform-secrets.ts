import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { bumpConfigVersion, cachedConfig, credentials, getDb, type Tx } from '@content-pilot/db';
import { PLATFORM_VAULT_SCOPE } from '@content-pilot/core';
import { decryptSecret, encryptSecret } from '@/lib/vault';

/**
 * Credenciais da PLATAFORMA: linhas de `credentials` com workspace_id NULL,
 * cifradas pelo mesmo vault das credenciais de cliente (AES-256-GCM, AAD
 * amarrado ao escopo `platform` + id da linha).
 *
 * Não existe um segundo cofre para segredos de plataforma de propósito —
 * reaproveitar a tabela dá rotação de chave, `maskedHint` e auditoria de
 * graça.
 */

export type PlatformSecretType = 'stripe' | 'resend' | 'openai' | 'openrouter' | 'anthropic' | 'tavily';

export interface PlatformCredential<T> {
  id: string;
  payload: T;
  maskedHint: string | null;
}

/**
 * Credencial de plataforma do tipo, já decifrada — ou null se não houver.
 *
 * Cacheado pela versão de config: girar a chave no painel invalida em até
 * 30s (imediato no processo que escreveu).
 */
export async function readPlatformCredential<T extends Record<string, unknown>>(
  type: PlatformSecretType,
): Promise<PlatformCredential<T> | null> {
  const db = getDb();
  return cachedConfig(db, `platform-secret:${type}`, async () => {
    const [row] = await db
      .select({
        id: credentials.id,
        ciphertext: credentials.ciphertext,
        maskedHint: credentials.maskedHint,
      })
      .from(credentials)
      .where(and(isNull(credentials.workspaceId), eq(credentials.type, type)))
      .orderBy(desc(credentials.updatedAt))
      .limit(1);
    if (!row) return null;
    try {
      const payload = decryptSecret<T>(row.ciphertext, PLATFORM_VAULT_SCOPE, row.id);
      return { id: row.id, payload, maskedHint: row.maskedHint };
    } catch (err) {
      // chave mestra trocada sem re-salvar a credencial, por exemplo
      console.error(`[platform-secrets] falha ao decifrar credencial ${type}`, err);
      return null;
    }
  });
}

/**
 * Resolve um campo do segredo: banco primeiro, env como reserva.
 *
 * O env é lido AQUI, a cada chamada, e nunca cacheado: se fosse capturado no
 * load do módulo, uma instalação que sobe só com .env cacheria o valor e
 * ignoraria a primeira gravação feita pelo painel.
 */
export function resolveSecretField(
  fromDb: string | null | undefined,
  envVar: string | undefined,
): { value: string | null; source: 'db' | 'env' | 'none' } {
  const db = fromDb?.trim();
  if (db) return { value: db, source: 'db' };
  const env = envVar?.trim();
  if (env) return { value: env, source: 'env' };
  return { value: null, source: 'none' };
}

/** Metadados das credenciais de plataforma para listagem — nada é decifrado. */
export async function listPlatformCredentials() {
  return getDb()
    .select({
      id: credentials.id,
      type: credentials.type,
      name: credentials.name,
      maskedHint: credentials.maskedHint,
      lastUsedAt: credentials.lastUsedAt,
      createdAt: credentials.createdAt,
      updatedAt: credentials.updatedAt,
    })
    .from(credentials)
    .where(isNull(credentials.workspaceId))
    .orderBy(credentials.type, desc(credentials.updatedAt));
}

/**
 * Grava (ou atualiza) a credencial de plataforma do tipo.
 *
 * Merge parcial de propósito: campo vazio MANTÉM o valor atual. Sem isso, o
 * operador que só quer girar a chave secreta apagaria o webhook secret ao
 * salvar o formulário.
 *
 * A linha é atualizada no lugar, preservando o id — o AAD do vault amarra o
 * ciphertext ao par (escopo, id), então trocar o id invalidaria o segredo.
 */
export async function upsertPlatformCredential(
  tx: Tx,
  opts: {
    type: PlatformSecretType;
    name: string;
    /** Campos a definir. Valor vazio/ausente preserva o que já existe. */
    patch: Record<string, string | undefined>;
    /** Campo usado para gerar o maskedHint exibido no painel. */
    hintField: string;
  },
): Promise<{ id: string; created: boolean; fields: string[] }> {
  const [existing] = await tx
    .select({ id: credentials.id, ciphertext: credentials.ciphertext })
    .from(credentials)
    .where(and(isNull(credentials.workspaceId), eq(credentials.type, opts.type)))
    .limit(1);

  const id = existing?.id ?? randomUUID();
  let payload: Record<string, string> = {};
  if (existing) {
    try {
      payload = decryptSecret<Record<string, string>>(existing.ciphertext, PLATFORM_VAULT_SCOPE, existing.id);
    } catch {
      // master key trocada sem re-salvar: recomeça em vez de travar o painel
      payload = {};
    }
  }
  for (const [field, raw] of Object.entries(opts.patch)) {
    const value = raw?.trim();
    if (value) payload[field] = value;
  }

  const hint = payload[opts.hintField];
  const maskedHint = hint ? `••••${hint.slice(-4)}` : null;
  const { ciphertext, keyId } = encryptSecret(payload, PLATFORM_VAULT_SCOPE, id);

  if (existing) {
    await tx
      .update(credentials)
      .set({ ciphertext, keyId, maskedHint, name: opts.name, updatedAt: new Date() })
      .where(eq(credentials.id, id));
  } else {
    await tx.insert(credentials).values({
      id,
      workspaceId: null,
      type: opts.type,
      name: opts.name,
      ciphertext,
      keyId,
      maskedHint,
    });
  }

  // o segredo decifrado fica no cache de config: sem carimbar a versão, este
  // e os demais processos seguiriam usando a chave antiga por até 30s
  await bumpConfigVersion(tx);

  return { id, created: !existing, fields: Object.keys(payload) };
}
