import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptCredential,
  encryptCredential,
  parseMasterKeys,
  VaultError,
  type MasterKeys,
} from '../src/vault';

const k1 = randomBytes(32);
const k2 = randomBytes(32);

function keys(): MasterKeys {
  return new Map([
    ['k1', k1],
    ['k2', k2],
  ]);
}

const ctx = { keys: keys(), workspaceId: 'ws-1', credentialId: 'cred-1' };

describe('parseMasterKeys', () => {
  it('parseia múltiplas chaves', () => {
    const raw = `k1:${k1.toString('base64')},k2:${k2.toString('base64')}`;
    const parsed = parseMasterKeys(raw);
    expect(parsed.size).toBe(2);
    expect(parsed.get('k1')!.equals(k1)).toBe(true);
  });

  it('rejeita env vazia e chave de tamanho errado', () => {
    expect(() => parseMasterKeys(undefined)).toThrow(VaultError);
    expect(() => parseMasterKeys('k1:' + Buffer.from('curta').toString('base64'))).toThrow(/32 bytes/);
  });
});

describe('encrypt/decrypt', () => {
  it('roundtrip preserva o payload', () => {
    const payload = { username: 'admin', appPassword: 'abcd efgh ijkl' };
    const stored = encryptCredential(payload, { ...ctx, activeKeyId: 'k1' });
    expect(stored).toMatch(/^enc:v1:k1:/);
    const { payload: out, keyId } = decryptCredential(stored, ctx);
    expect(out).toEqual(payload);
    expect(keyId).toBe('k1');
  });

  it('cada operação gera IV diferente', () => {
    const a = encryptCredential({ x: 1 }, { ...ctx, activeKeyId: 'k1' });
    const b = encryptCredential({ x: 1 }, { ...ctx, activeKeyId: 'k1' });
    expect(a).not.toBe(b);
  });

  it('rejeita ciphertext adulterado', () => {
    const stored = encryptCredential({ apiKey: 'sk-123' }, { ...ctx, activeKeyId: 'k1' });
    const parts = stored.split(':');
    const ct = Buffer.from(parts[4]!, 'base64');
    ct[0] = ct[0]! ^ 0xff;
    parts[4] = ct.toString('base64');
    expect(() => decryptCredential(parts.join(':'), ctx)).toThrow(/autenticação/);
  });

  it('rejeita replantio em outra credencial/workspace (AAD)', () => {
    const stored = encryptCredential({ apiKey: 'sk-123' }, { ...ctx, activeKeyId: 'k1' });
    expect(() => decryptCredential(stored, { ...ctx, credentialId: 'cred-2' })).toThrow(/autenticação/);
    expect(() => decryptCredential(stored, { ...ctx, workspaceId: 'ws-2' })).toThrow(/autenticação/);
  });

  it('rotação: decripta com a chave antiga via keyId e re-encripta com a nova', () => {
    const stored = encryptCredential({ apiKey: 'sk-old' }, { ...ctx, activeKeyId: 'k1' });
    const { payload, keyId } = decryptCredential(stored, ctx);
    expect(keyId).toBe('k1');
    const rotated = encryptCredential(payload, { ...ctx, activeKeyId: 'k2' });
    expect(rotated).toMatch(/^enc:v1:k2:/);
    expect(decryptCredential(rotated, ctx).payload).toEqual({ apiKey: 'sk-old' });
  });

  it('erro claro quando keyId não existe', () => {
    const stored = encryptCredential({ apiKey: 'x' }, { ...ctx, activeKeyId: 'k1' });
    const onlyK2 = { ...ctx, keys: new Map([['k2', k2]]) };
    expect(() => decryptCredential(stored, onlyK2)).toThrow(/não está em VAULT_MASTER_KEYS/);
  });

  it('rejeita formato malformado', () => {
    expect(() => decryptCredential('lixo', ctx)).toThrow(/Formato/);
    expect(() => decryptCredential('enc:v2:k1:a:b:c', ctx)).toThrow(/Formato/);
  });
});
