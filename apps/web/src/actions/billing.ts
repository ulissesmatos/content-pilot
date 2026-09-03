'use server';

import { eq } from 'drizzle-orm';
import { getDb, subscriptions, workspaces } from '@content-pilot/db';
import { PLANS, type PlanId } from '@content-pilot/core';
import { z } from 'zod';
import { runAuthedAction, type ActionResult } from '@/lib/action-utils';
import { appBaseUrl, getStripe, priceIdForPlan } from '@/lib/stripe';

const checkoutSchema = z.object({
  plan: z.enum(['starter', 'pro']),
});

/**
 * Cria uma Checkout Session de assinatura para o plano escolhido e devolve a
 * URL de pagamento. O webhook (/api/stripe/webhook) confirma e grava o plano.
 */
export async function createCheckoutSessionAction(input: unknown): Promise<ActionResult<{ url: string }>> {
  return runAuthedAction(checkoutSchema, input, async ({ plan }, { workspaceId, email }) => {
    if (!PLANS[plan as PlanId]?.purchasable) throw new Error('Plano inválido.');
    const stripe = await getStripe();
    const db = getDb();

    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, workspaceId))
      .limit(1);
    if (sub?.stripeSubscriptionId && sub.status !== 'canceled') {
      throw new Error('Este workspace já tem assinatura ativa — gerencie o plano pelo portal de cobrança.');
    }

    const [ws] = await db
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    // Reusa o customer se já existir; senão o Checkout cria um novo.
    const base = await appBaseUrl();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceIdForPlan(plan), quantity: 1 }],
      ...(sub?.stripeCustomerId ? { customer: sub.stripeCustomerId } : { customer_email: email }),
      client_reference_id: workspaceId,
      metadata: { workspaceId, workspaceName: ws?.name ?? '' },
      subscription_data: { metadata: { workspaceId } },
      allow_promotion_codes: true,
      success_url: `${base}/billing?checkout=success`,
      cancel_url: `${base}/billing?checkout=cancelled`,
    });
    if (!session.url) throw new Error('Stripe não retornou URL de checkout.');
    return { url: session.url };
  });
}

const emptySchema = z.object({});

/** Portal do cliente Stripe: trocar plano, cartão, cancelar. */
export async function createPortalSessionAction(input: unknown): Promise<ActionResult<{ url: string }>> {
  return runAuthedAction(emptySchema, input ?? {}, async (_data, { workspaceId }) => {
    const db = getDb();
    const [sub] = await db
      .select({ stripeCustomerId: subscriptions.stripeCustomerId })
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, workspaceId))
      .limit(1);
    if (!sub?.stripeCustomerId) {
      throw new Error('Nenhuma assinatura encontrada — assine um plano primeiro.');
    }
    const stripe = await getStripe();
    const base = await appBaseUrl();
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${base}/billing`,
    });
    return { url: session.url };
  });
}
