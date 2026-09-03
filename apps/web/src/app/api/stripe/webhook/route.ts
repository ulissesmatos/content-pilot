import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { getDb, subscriptions } from '@content-pilot/db';
import { getStripe, getStripeWebhookSecret, planFromPriceId, subscriptionPeriodEnd } from '@/lib/stripe';

export const runtime = 'nodejs';

/**
 * Webhook do Stripe (Fase 5). Assinatura verificada com o webhook secret do
 * vault (ou do .env, como reserva) —
 * requisições sem assinatura válida são rejeitadas (401). Idempotente: cada
 * evento faz upsert do estado da assinatura do workspace; eventos repetidos ou
 * fora de ordem convergem para o estado atual do objeto no Stripe.
 *
 * Eventos tratados:
 * - checkout.session.completed        → vincula customer/subscription ao workspace
 * - customer.subscription.created/updated → plano, status, período, cancelamento
 * - customer.subscription.deleted     → volta ao free
 * - invoice.payment_failed            → past_due (limites do plano pago ainda valem
 *                                       até o Stripe cancelar de vez)
 */
export async function POST(req: Request) {
  // Header primeiro: é a rejeição mais barata de uma requisição não
  // autenticada, e evita ir ao banco buscar o segredo por causa de ruído.
  const signature = req.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'assinatura ausente' }, { status: 401 });

  const secret = await getStripeWebhookSecret();
  if (!secret) {
    console.error('[stripe] webhook secret não configurado (vault nem .env)');
    return NextResponse.json({ error: 'webhook não configurado' }, { status: 500 });
  }

  const payload = await req.text();
  let event: Stripe.Event;
  try {
    const stripe = await getStripe();
    event = stripe.webhooks.constructEvent(payload, signature, secret);
  } catch (err) {
    console.error('[stripe] assinatura inválida:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'assinatura inválida' }, { status: 401 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode !== 'subscription') break;
        const workspaceId = session.metadata?.workspaceId ?? session.client_reference_id;
        if (!workspaceId) {
          console.warn(`[stripe] checkout ${session.id} sem workspaceId — ignorando`);
          break;
        }
        const subscriptionId =
          typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
        const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
        if (!subscriptionId) break;
        const stripe = await getStripe();
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        await applySubscription(workspaceId, sub, customerId ?? null);
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const workspaceId = await resolveWorkspaceId(sub);
        if (!workspaceId) {
          console.warn(`[stripe] subscription ${sub.id} sem workspaceId — ignorando`);
          break;
        }
        await applySubscription(workspaceId, sub, typeof sub.customer === 'string' ? sub.customer : sub.customer.id);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const workspaceId = await resolveWorkspaceId(sub);
        if (!workspaceId) break;
        await getDb()
          .update(subscriptions)
          .set({
            plan: 'free',
            status: 'canceled',
            stripeSubscriptionId: null,
            stripePriceId: null,
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.workspaceId, workspaceId));
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
        if (!customerId) break;
        await getDb()
          .update(subscriptions)
          .set({ status: 'past_due', updatedAt: new Date() })
          .where(eq(subscriptions.stripeCustomerId, customerId));
        break;
      }

      default:
        break;
    }
  } catch (err) {
    // 500 → o Stripe re-tenta o evento depois
    console.error(`[stripe] erro processando ${event.type}:`, err);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

/** workspaceId da assinatura: metadata (fonte primária) ou lookup pelo customer. */
async function resolveWorkspaceId(sub: Stripe.Subscription): Promise<string | null> {
  if (sub.metadata?.workspaceId) return sub.metadata.workspaceId;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const [row] = await getDb()
    .select({ workspaceId: subscriptions.workspaceId })
    .from(subscriptions)
    .where(eq(subscriptions.stripeCustomerId, customerId))
    .limit(1);
  return row?.workspaceId ?? null;
}

/** Upsert do estado da assinatura de um workspace a partir do objeto do Stripe. */
async function applySubscription(workspaceId: string, sub: Stripe.Subscription, customerId: string | null) {
  const priceId = sub.items.data[0]?.price?.id ?? null;
  const plan = planFromPriceId(priceId);
  if (priceId && !plan) {
    console.warn(`[stripe] price ${priceId} não mapeado para plano — mantendo plano atual`);
  }
  const status = normalizeStatus(sub.status);
  const values = {
    ...(plan ? { plan } : {}),
    status,
    stripeCustomerId: customerId ?? (typeof sub.customer === 'string' ? sub.customer : sub.customer.id),
    stripeSubscriptionId: sub.id,
    stripePriceId: priceId,
    currentPeriodEnd: subscriptionPeriodEnd(sub),
    cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
    updatedAt: new Date(),
  };

  await getDb()
    .insert(subscriptions)
    .values({ workspaceId, plan: plan ?? 'free', ...values })
    .onConflictDoUpdate({ target: subscriptions.workspaceId, set: values });
}

function normalizeStatus(s: Stripe.Subscription.Status): 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete' {
  switch (s) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
      return 'past_due';
    case 'canceled':
      return 'canceled';
    case 'unpaid':
      return 'unpaid';
    default:
      // incomplete, incomplete_expired, paused → sem acesso pago
      return 'incomplete';
  }
}
