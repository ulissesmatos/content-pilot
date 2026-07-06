import { decryptCredential, parseMasterKeys, type MasterKeys } from '@content-pilot/core';

let cachedKeys: MasterKeys | null = null;

function keys(): MasterKeys {
  if (!cachedKeys) cachedKeys = parseMasterKeys(process.env.VAULT_MASTER_KEYS);
  return cachedKeys;
}

export function decryptSecret<T = Record<string, unknown>>(
  stored: string,
  workspaceId: string,
  credentialId: string,
): T {
  return decryptCredential<T>(stored, { keys: keys(), workspaceId, credentialId }).payload;
}
