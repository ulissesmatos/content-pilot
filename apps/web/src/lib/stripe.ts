import 'server-only';
import Stripe from 'stripe';
import type { PlanId } from '@content-pilot/core';

/**
 * Cliente Stripe (Fase 5). A versão da API fica pinada pelo SDK (stripe-node
 * v22) — não fixamos apiVersion aqui para não divergir dos types do SDK.
 * Preços: cada plano comprável tem um Price recorrente no Stripe, mapeado por
 * env (STRIPE_PRICE_STARTER / STRIPE_PRICE_PRO).
 */

let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (!cached) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY não definida — configure a cobrança no .env.');
    cached = new Stripe(key);
  }
  return cached;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
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

/** Base URL do painel (success/cancel/portal return). */
export function appBaseUrl(): string {
  return (process.env.AUTH_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
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
