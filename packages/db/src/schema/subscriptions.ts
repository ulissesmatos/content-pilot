import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

/**
 * Assinatura Stripe de um workspace (Fase 5 — SaaS multi-tenant).
 * Uma linha por workspace; workspaces sem linha estão no plano `free`.
 * `plan` é o id lógico (free/starter/pro) mapeado a partir do price do Stripe;
 * os limites de cada plano vivem em @content-pilot/core (billing/plans.ts) —
 * o banco guarda só o estado da assinatura, nunca os limites (que podem mudar
 * sem migração).
 * status segue o ciclo do Stripe: active, trialing, past_due, canceled, unpaid.
 */
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .unique()
      .references(() => workspaces.id),
    plan: text('plan').notNull().default('free'),
    status: text('status', {
      enum: ['active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete'],
    })
      .notNull()
      .default('active'),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripePriceId: text('stripe_price_id'),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('subscriptions_stripe_customer_idx').on(t.stripeCustomerId)],
);
