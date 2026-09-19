import 'server-only';
import { getDb, getSetting } from '@content-pilot/db';
import {
  EMAIL_SETTINGS_DEFAULT,
  emailSettingsSchema,
  isValidSender,
  ResendClient,
  SETTINGS_KEYS,
  type EmailLocale,
  type EmailMessage,
} from '@content-pilot/core';
import { readPlatformCredential, resolveSecretField } from '@/lib/platform-secrets';
import { isLocale } from '@/i18n/config';

/**
 * Envio transacional via Resend.
 *
 * Mesma cascata do Stripe: chave no cofre (credencial de plataforma `resend`),
 * `RESEND_API_KEY` do ambiente como reserva. O remetente é config não-secreta
 * (`platform_settings.email`), com `EMAIL_FROM` de reserva.
 */

export interface EmailConfig {
  apiKey: string | null;
  from: string | null;
  replyTo: string | null;
  apiKeySource: 'db' | 'env' | 'none';
  fromSource: 'db' | 'env' | 'none';
  maskedHint: string | null;
}

export async function getEmailConfig(): Promise<EmailConfig> {
  const [cred, settings] = await Promise.all([
    readPlatformCredential<{ apiKey?: string }>('resend'),
    getSetting(getDb(), SETTINGS_KEYS.email, emailSettingsSchema, EMAIL_SETTINGS_DEFAULT),
  ]);
  const key = resolveSecretField(cred?.payload.apiKey, process.env.RESEND_API_KEY);
  const from = resolveSecretField(settings.fromAddress, process.env.EMAIL_FROM);
  return {
    apiKey: key.value,
    from: from.value,
    replyTo: settings.replyTo?.trim() || null,
    apiKeySource: key.source,
    fromSource: from.source,
    maskedHint: cred?.maskedHint ?? null,
  };
}

/** Chave e remetente válidos. O painel usa isto para avisar o operador. */
export async function isEmailConfigured(): Promise<boolean> {
  const { apiKey, from } = await getEmailConfig();
  return Boolean(apiKey && from && isValidSender(from));
}

/**
 * Envia e devolve se conseguiu, em vez de lançar.
 *
 * Quem chama são os fluxos de senha, e lá a resposta ao usuário NÃO pode
 * depender disso: revelar "falhou ao enviar" já diz que a conta existe. O
 * erro real vai para o log do servidor, onde é problema do operador.
 */
export async function trySendEmail(message: EmailMessage, context: string): Promise<boolean> {
  const config = await getEmailConfig();
  if (!config.apiKey || !config.from) {
    console.error(`[email:${context}] envio ignorado — Resend não configurado em /admin/settings.`);
    return false;
  }
  if (!isValidSender(config.from)) {
    console.error(`[email:${context}] remetente inválido: "${config.from}".`);
    return false;
  }
  try {
    const client = new ResendClient({
      apiKey: config.apiKey,
      from: config.from,
      replyTo: config.replyTo ?? undefined,
    });
    await client.send(message);
    return true;
  } catch (err) {
    console.error(`[email:${context}] falha no envio`, err);
    return false;
  }
}

/** Locale do request reduzido ao conjunto que os templates conhecem. */
export function emailLocale(locale: string): EmailLocale {
  return isLocale(locale) ? locale : 'pt-BR';
}

/**
 * Base absoluta dos links do e-mail.
 *
 * Nunca derivada do Host da request: um Host forjado colocaria o link de troca
 * de senha apontando para o servidor do atacante.
 */
export function appBaseUrl(): string {
  return (process.env.AUTH_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
}
