import 'server-only';
import {
  decryptCredential,
  encryptCredential,
  parseMasterKeys,
  VaultError,
  type MasterKeys,
} from '@content-pilot/core';

let cached: { keys: MasterKeys; activeKeyId: string } | null = null;

function vaultConfig() {
  if (!cached) {
    const keys = parseMasterKeys(process.env.VAULT_MASTER_KEYS);
    const activeKeyId = process.env.VAULT_ACTIVE_KEY_ID ?? '';
    if (!keys.has(activeKeyId)) {
      throw new VaultError(`VAULT_ACTIVE_KEY_ID "${activeKeyId}" não existe em VAULT_MASTER_KEYS`);
    }
    cached = { keys, activeKeyId };
  }
  return cached;
}

export function encryptSecret(payload: Record<string, unknown>, workspaceId: string, credentialId: string) {
  const { keys, activeKeyId } = vaultConfig();
  const ciphertext = encryptCredential(payload, { keys, activeKeyId, workspaceId, credentialId });
  return { ciphertext, keyId: activeKeyId };
}

export function decryptSecret<T = Record<string, unknown>>(
  stored: string,
  workspaceId: string,
  credentialId: string,
): T {
  const { keys } = vaultConfig();
  return decryptCredential<T>(stored, { keys, workspaceId, credentialId }).payload;
}
