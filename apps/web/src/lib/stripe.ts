import 'server-only';
import Stripe from 'stripe';
import { getDb } from '@content-pilot/db';
import { getSetting } from '@content-pilot/db';
import {
  SETTINGS_KEYS,
  STRIPE_SETTINGS_DEFAULT,
  stripeSettingsSchema,
  type PlanId,
} from '@content-pilot/core';
import { readPlatformCredential, resolveSecretField } from '@/lib/platform-secrets';

/**
 * Cliente Stripe. A versão da API fica pinada pelo SDK (stripe-node v22) —
 * não fixamos apiVersion aqui para não divergir dos types do SDK.
 *
 * Os segredos vêm do vault (credencial de plataforma do tipo `stripe`), com
 * as variáveis STRIPE_* do .env como reserva. Assim dá para trocar a chave
 * pelo painel sem deploy, e uma instalação antiga que só tem .env continua
 * funcionando sem migração manual.
 */

export interface StripeSecrets {
  secretKey: string | null;
  webhookSecret: string | null;
  /** De onde veio cada valor — o painel mostra isso ao operador. */
  secretKeySource: 'db' | 'env' | 'none';
  webhookSecretSource: 'db' | 'env' | 'none';
  maskedHint: string | null;
}

export async function getStripeSecrets(): Promise<StripeSecrets> {
  const cred = await readPlatformCredential<{ secretKey?: string; webhookSecret?: string }>('stripe');
  // resolvido por campo: dá para ter a chave no banco e o webhook ainda no env
  const secret = resolveSecretField(cred?.payload.secretKey, process.env.STRIPE_SECRET_KEY);
  const webhook = resolveSecretField(cred?.payload.webhookSecret, process.env.STRIPE_WEBHOOK_SECRET);
  return {
    secretKey: secret.value,
    webhookSecret: webhook.value,
    secretKeySource: secret.source,
    webhookSecretSource: webhook.source,
    maskedHint: cred?.maskedHint ?? null,
  };
}

// Cacheado pelo próprio valor da chave: girar o segredo troca o cliente
// sozinho, sem precisar de invalidação explícita.
let cachedClient: { key: string; client: Stripe } | null = null;

export async function getStripe(): Promise<Stripe> {
  const { secretKey } = await getStripeSecrets();
  if (!secretKey) {
    throw new Error('Chave secreta do Stripe não configurada — defina em /admin/settings.');
  }
  if (cachedClient?.key !== secretKey) {
    cachedClient = { key: secretKey, client: new Stripe(secretKey) };
  }
  return cachedClient.client;
}

export async function getStripeWebhookSecret(): Promise<string | null> {
  return (await getStripeSecrets()).webhookSecret;
}

export async function isStripeConfigured(): Promise<boolean> {
  return Boolean((await getStripeSecrets()).secretKey);
}

const PRICE_ENV: Record<string, string | undefined> = {
  get starter() {
    return process.env.STRIPE_PRICE_STARTER;
  },
  get pro() {
    return process.env.STRIPE_PRICE_PRO;
  },
};

export function priceIdForPlan(plan: PlanId): string {
  const priceId = plan === 'starter' ? PRICE_ENV.starter : plan === 'pro' ? PRICE_ENV.pro : undefined;
  if (!priceId) throw new Error(`Plano "${plan}" sem STRIPE_PRICE_* configurado.`);
  return priceId;
}

export function planFromPriceId(priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null;
  if (priceId === PRICE_ENV.starter) return 'starter';
  if (priceId === PRICE_ENV.pro) return 'pro';
  return null;
}

/**
 * Base URL do painel (success/cancel/portal return). O painel pode
 * sobrescrever o AUTH_URL do .env — útil quando o domínio público difere do
 * configurado no ambiente.
 */
export async function appBaseUrl(): Promise<string> {
  const settings = await getSetting(
    getDb(),
    SETTINGS_KEYS.stripe,
    stripeSettingsSchema,
    STRIPE_SETTINGS_DEFAULT,
  );
  const base = settings.appBaseUrl ?? process.env.AUTH_URL ?? 'http://localhost:3000';
  return base.replace(/\/+$/, '');
}

/**
 * Fim do período atual da assinatura. Nas versões novas da API do Stripe
 * (2025-03+/Basil), `current_period_end` vive nos itens; em versões antigas,
 * no próprio objeto. Lemos os dois formatos.
 */
export function subscriptionPeriodEnd(sub: Stripe.Subscription): Date | null {
  const fromItem = sub.items?.data?.[0]?.current_period_end;
  const legacy = (sub as unknown as { current_period_end?: number }).current_period_end;
  const ts = fromItem ?? legacy;
  return typeof ts === 'number' ? new Date(ts * 1000) : null;
}
