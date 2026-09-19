'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { setSetting } from '@content-pilot/db';
import { emailSettingsSchema, isValidSender, SETTINGS_KEYS, stripeSettingsSchema } from '@content-pilot/core';
import { runAdminAction } from '@/lib/admin-action';
import { upsertPlatformCredential } from '@/lib/platform-secrets';
import type { ActionResult } from '@/lib/action-utils';

/**
 * Campo de segredo opcional: string vazia significa "não mexer", e o formato
 * é validado na entrada para pegar erro de colagem antes de virar 401 do
 * Stripe em produção.
 */
const optionalSecret = (pattern: RegExp, message: string) =>
  z
    .string()
    .max(300)
    .optional()
    .transform((v) => v?.trim() ?? '')
    .refine((v) => v === '' || pattern.test(v), { message });

const stripeSecretsSchema = z
  .object({
    secretKey: optionalSecret(
      /^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}$/,
      'Formato inválido — esperado sk_test_… ou sk_live_…',
    ),
    webhookSecret: optionalSecret(/^whsec_[A-Za-z0-9]{10,}$/, 'Formato inválido — esperado whsec_…'),
  })
  .refine((v) => v.secretKey !== '' || v.webhookSecret !== '', {
    message: 'Preencha ao menos um campo.',
    path: ['secretKey'],
  });

/**
 * Salva as chaves do Stripe no vault (credencial de plataforma).
 *
 * Só o super admin: quem tem a chave secreta do Stripe pode movimentar
 * dinheiro da operação.
 */
export async function saveStripeSecretsAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAdminAction(
    stripeSecretsSchema,
    input,
    { action: 'settings.stripe.secrets', targetType: 'credential', superAdminOnly: true },
    async (data, { tx, audit }) => {
      const result = await upsertPlatformCredential(tx, {
        type: 'stripe',
        name: 'Stripe (plataforma)',
        patch: { secretKey: data.secretKey, webhookSecret: data.webhookSecret },
        hintField: 'secretKey',
      });

      // a auditoria registra QUAIS campos mudaram, nunca os valores
      audit({
        targetId: result.id,
        diff: {
          created: result.created,
          updatedFields: [
            data.secretKey ? 'secretKey' : null,
            data.webhookSecret ? 'webhookSecret' : null,
          ].filter(Boolean),
          mode: data.secretKey.startsWith('sk_live') || data.secretKey.startsWith('rk_live') ? 'live' : undefined,
        },
      });

      revalidatePath('/admin/settings');
      revalidatePath('/billing');
      return { id: result.id };
    },
  );
}

const appUrlSchema = z.object({
  appBaseUrl: z
    .string()
    .max(300)
    .optional()
    .transform((v) => v?.trim() ?? '')
    .refine((v) => v === '' || /^https?:\/\/[^\s]+$/.test(v), { message: 'URL inválida.' }),
});

/** URL base usada nos retornos do Stripe (checkout, portal). */
export async function saveStripeSettingsAction(input: unknown): Promise<ActionResult<null>> {
  return runAdminAction(
    appUrlSchema,
    input,
    { action: 'settings.stripe.appUrl', targetType: 'settings', superAdminOnly: true },
    async (data, { tx, session, audit }) => {
      const next = stripeSettingsSchema.parse({
        appBaseUrl: data.appBaseUrl === '' ? null : data.appBaseUrl.replace(/\/+$/, ''),
      });
      await setSetting(tx, SETTINGS_KEYS.stripe, next, session.userId);
      audit({ targetId: SETTINGS_KEYS.stripe, diff: { after: next } });
      revalidatePath('/admin/settings');
      return null;
    },
  );
}

const resendKeySchema = z.object({
  // Chave do Resend: re_… — o prefixo é estável e pega erro de colagem antes
  // de virar 401 silencioso no primeiro pedido de senha esquecida.
  apiKey: z
    .string()
    .trim()
    .min(8, 'Chave muito curta')
    .max(300)
    .refine((v) => /^re_[A-Za-z0-9_-]{8,}$/.test(v), { message: 'Formato inválido — esperado re_…' }),
});

/** Chave do Resend no cofre. Só o super admin: ela envia e-mail em nome do domínio. */
export async function saveResendKeyAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAdminAction(
    resendKeySchema,
    input,
    { action: 'settings.resend.key', targetType: 'credential', superAdminOnly: true },
    async (data, { tx, audit }) => {
      const result = await upsertPlatformCredential(tx, {
        type: 'resend',
        name: 'Resend (plataforma)',
        patch: { apiKey: data.apiKey },
        hintField: 'apiKey',
      });
      audit({ targetId: result.id, diff: { created: result.created, updatedFields: ['apiKey'] } });
      revalidatePath('/admin/settings');
      return { id: result.id };
    },
  );
}

const emailSenderSchema = z.object({
  fromAddress: z
    .string()
    .max(200)
    .optional()
    .transform((v) => v?.trim() ?? '')
    .refine((v) => v === '' || isValidSender(v), {
      message: 'Use conta@dominio.com ou Nome <conta@dominio.com>.',
    }),
  replyTo: z
    .string()
    .max(200)
    .optional()
    .transform((v) => v?.trim() ?? '')
    .refine((v) => v === '' || isValidSender(v), { message: 'Endereço inválido.' }),
});

/** Remetente dos e-mails transacionais (não é segredo — vai em platform_settings). */
export async function saveEmailSettingsAction(input: unknown): Promise<ActionResult<null>> {
  return runAdminAction(
    emailSenderSchema,
    input,
    { action: 'settings.email.sender', targetType: 'settings', superAdminOnly: true },
    async (data, { tx, session, audit }) => {
      const next = emailSettingsSchema.parse({
        fromAddress: data.fromAddress === '' ? null : data.fromAddress,
        replyTo: data.replyTo === '' ? null : data.replyTo,
      });
      await setSetting(tx, SETTINGS_KEYS.email, next, session.userId);
      audit({ targetId: SETTINGS_KEYS.email, diff: { after: next } });
      revalidatePath('/admin/settings');
      return null;
    },
  );
}
