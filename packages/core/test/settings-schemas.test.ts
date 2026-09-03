import { describe, expect, it } from 'vitest';
import {
  SETTINGS_KEYS,
  STRIPE_SETTINGS_DEFAULT,
  stripeSettingsSchema,
} from '../src/settings/schemas';

describe('stripeSettingsSchema', () => {
  it('linha ausente vira o padrão: instalação nova funciona sem abrir o painel', () => {
    expect(stripeSettingsSchema.parse({})).toEqual({ appBaseUrl: null });
    expect(STRIPE_SETTINGS_DEFAULT).toEqual({ appBaseUrl: null });
  });

  it('aceita URL válida e recusa lixo', () => {
    expect(stripeSettingsSchema.parse({ appBaseUrl: 'https://app.exemplo.com' }).appBaseUrl).toBe(
      'https://app.exemplo.com',
    );
    expect(stripeSettingsSchema.safeParse({ appBaseUrl: 'nao-e-url' }).success).toBe(false);
  });

  it('safeParse falha em conteúdo corrompido — quem lê cai no padrão', () => {
    expect(stripeSettingsSchema.safeParse({ appBaseUrl: 42 }).success).toBe(false);
    expect(stripeSettingsSchema.safeParse('string solta').success).toBe(false);
  });

  it('a chave do Stripe é estável (é o id da linha em platform_settings)', () => {
    expect(SETTINGS_KEYS.stripe).toBe('stripe');
  });
});
