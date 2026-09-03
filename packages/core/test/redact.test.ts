import { describe, expect, it } from 'vitest';
import { isSecretField, redactSecrets, REDACTED } from '../src/settings/redact';

describe('redactSecrets', () => {
  it('mascara os campos que carregam segredo', () => {
    const out = redactSecrets({
      secretKey: 'sk_live_EXEMPLO_FALSO',
      webhookSecret: 'whsec_EXEMPLO_FALSO',
      apiKey: 'sk-proj-EXEMPLO_FALSO',
      password: 'hunter2',
      ciphertext: 'enc:v1:k1:...',
    }) as Record<string, unknown>;
    for (const v of Object.values(out)) expect(v).toBe(REDACTED);
  });

  it('preserva identificadores públicos — auditoria sem eles não rastreia nada', () => {
    const out = redactSecrets({
      keyId: 'k1',
      maskedHint: '••••cdef',
      credentialId: 'uuid-1',
      stripeCustomerId: 'cus_123',
    }) as Record<string, unknown>;
    expect(out).toEqual({
      keyId: 'k1',
      maskedHint: '••••cdef',
      credentialId: 'uuid-1',
      stripeCustomerId: 'cus_123',
    });
  });

  it('alcança campos aninhados e dentro de arrays', () => {
    const out = redactSecrets({
      before: { apiKey: 'antiga' },
      items: [{ token: 'a' }, { token: 'b' }],
    }) as { before: Record<string, unknown>; items: Array<Record<string, unknown>> };
    expect(out.before.apiKey).toBe(REDACTED);
    expect(out.items.map((i) => i.token)).toEqual([REDACTED, REDACTED]);
  });

  it('limita profundidade, tamanho de array e de string', () => {
    let deep: Record<string, unknown> = { fim: 'ok' };
    for (let i = 0; i < 10; i++) deep = { nivel: deep };
    expect(JSON.stringify(redactSecrets(deep))).toContain('aninhado demais');

    expect((redactSecrets(Array.from({ length: 200 }, (_, i) => i)) as unknown[]).length).toBe(50);

    const long = redactSecrets('x'.repeat(1000)) as string;
    expect(long.length).toBeLessThanOrEqual(501);
    expect(long.endsWith('…')).toBe(true);
  });

  it('não mexe em valores comuns', () => {
    expect(redactSecrets({ email: 'a@b.com', status: 'active', n: 3, ok: true })).toEqual({
      email: 'a@b.com',
      status: 'active',
      n: 3,
      ok: true,
    });
  });

  it('isSecretField distingue o identificador do segredo', () => {
    expect(isSecretField('apiKey')).toBe(true);
    expect(isSecretField('api_key')).toBe(true);
    expect(isSecretField('keyId')).toBe(false);
    expect(isSecretField('email')).toBe(false);
  });
});
