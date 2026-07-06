import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Vault de credenciais — AES-256-GCM.
 *
 * Formato armazenado: `enc:v1:<keyId>:<iv b64>:<ciphertext b64>:<authTag b64>`
 * - IV aleatório de 12 bytes por operação.
 * - AAD = `${workspaceId}:${credentialId}` — amarra o ciphertext à linha do
 *   banco; replantar o valor em outra credencial/workspace falha na autenticação.
 * - `keyId` identifica qual master key criptografou, permitindo rotação:
 *   novas escritas usam a chave ativa, leituras usam a chave da linha.
 */

const FORMAT_PREFIX = 'enc';
const FORMAT_VERSION = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultError';
  }
}

export type MasterKeys = Map<string, Buffer>;

/** Parseia o env VAULT_MASTER_KEYS ("k1:<b64>,k2:<b64>"). */
export function parseMasterKeys(raw: string | undefined): MasterKeys {
  if (!raw?.trim()) throw new VaultError('VAULT_MASTER_KEYS não definida');
  const keys: MasterKeys = new Map();
  for (const entry of raw.split(',')) {
    const sep = entry.indexOf(':');
    if (sep <= 0) throw new VaultError(`Entrada inválida em VAULT_MASTER_KEYS: "${entry.slice(0, 8)}..."`);
    const keyId = entry.slice(0, sep).trim();
    const material = Buffer.from(entry.slice(sep + 1).trim(), 'base64');
    if (material.length !== KEY_BYTES) {
      throw new VaultError(`Master key "${keyId}" deve ter ${KEY_BYTES} bytes (base64), tem ${material.length}`);
    }
    keys.set(keyId, material);
  }
  return keys;
}

export interface VaultContext {
  keys: MasterKeys;
  /** AAD — deve ser idêntico entre encrypt e decrypt. */
  workspaceId: string;
  credentialId: string;
}

function aadFor(ctx: VaultContext): Buffer {
  return Buffer.from(`${ctx.workspaceId}:${ctx.credentialId}`, 'utf8');
}

export function encryptCredential(
  payload: Record<string, unknown>,
  ctx: VaultContext & { activeKeyId: string },
): string {
  const key = ctx.keys.get(ctx.activeKeyId);
  if (!key) throw new VaultError(`Chave ativa "${ctx.activeKeyId}" não encontrada em VAULT_MASTER_KEYS`);

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aadFor(ctx));
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    FORMAT_PREFIX,
    FORMAT_VERSION,
    ctx.activeKeyId,
    iv.toString('base64'),
    ct.toString('base64'),
    tag.toString('base64'),
  ].join(':');
}

/** Retorna também o keyId usado, para o chamador saber se a linha precisa de re-encrypt na rotação. */
export function decryptCredential<T = Record<string, unknown>>(
  stored: string,
  ctx: VaultContext,
): { payload: T; keyId: string } {
  const parts = stored.split(':');
  if (parts.length !== 6 || parts[0] !== FORMAT_PREFIX || parts[1] !== FORMAT_VERSION) {
    throw new VaultError('Formato de ciphertext inválido');
  }
  const [, , keyId, ivB64, ctB64, tagB64] = parts as [string, string, string, string, string, string];
  const key = ctx.keys.get(keyId);
  if (!key) throw new VaultError(`Master key "${keyId}" desta credencial não está em VAULT_MASTER_KEYS`);

  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAAD(aadFor(ctx));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]);
  } catch {
    throw new VaultError('Falha na autenticação do ciphertext (dados adulterados ou AAD incorreto)');
  }
  return { payload: JSON.parse(plaintext.toString('utf8')) as T, keyId };
}
