import { CheckCircle2, CircleAlert, Sparkles } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { PLANS, type PlanDef, type PlanId } from '@content-pilot/core';
import { ManageSubscriptionButton, UpgradeButton } from '@/components/billing/billing-buttons';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireSession } from '@/lib/auth';
import { getConsumptionPlan, getMonthUsage, getSubscription, getWorkspacePlan } from '@/lib/billing';
import { isStripeConfigured } from '@/lib/stripe';
import { dateTimeFormat } from '@/lib/datetime';

export const metadata = { title: 'Plano e cobrança' };

function UsageBar({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const tone = pct >= 100 ? 'bg-destructive' : pct >= 80 ? 'bg-amber-500' : 'bg-primary';
  return (
    <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { workspaceId, role } = await requireSession();
  // `plan` governa sites/autopilots; `consumption` governa posts/tokens e já
  // vem sem cotas quando o workspace paga a própria IA.
  const [t, locale, plan, consumption, sub, usage, params, stripeReady] = await Promise.all([
    getTranslations('billing'),
    getLocale(),
    getWorkspacePlan(workspaceId),
    getConsumptionPlan(workspaceId),
    getSubscription(workspaceId),
    getMonthUsage(workspaceId),
    searchParams,
    isStripeConfigured(),
  ]);

  const nf = new Intl.NumberFormat(locale);
  const dateFmt = dateTimeFormat(locale, { dateStyle: 'long' });
  const money = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' });

  const planName = (id: PlanId) =>
    id === 'free' ? t('planFree') : id === 'starter' ? t('planStarter') : id === 'pro' ? t('planPro') : t('planUnlimited');

  const statusLabel: Record<string, string> = {
    active: t('statusActive'),
    trialing: t('statusTrialing'),
    past_due: t('statusPastDue'),
    canceled: t('statusCanceled'),
    unpaid: t('statusUnpaid'),
    incomplete: t('statusIncomplete'),
  };

  const isUnlimited = plan.id === 'unlimited';
  const fmtLimit = (n: number) => (n >= Number.MAX_SAFE_INTEGER ? t('unlimited') : nf.format(n));
  // BYOK só derruba consumo; o cartão precisa dizer isso para o usuário não
  // achar que sites e autopilots também ficaram ilimitados.
  const byokLifted = !isUnlimited && consumption.limits.postsPerMonth >= Number.MAX_SAFE_INTEGER;
  const postsLimit = consumption.limits.postsPerMonth;
  const tokensLimit = consumption.limits.tokensPerMonth;

  const purchasable = (['starter', 'pro'] as const).filter((id) => process.env.BILLING_ENABLED === 'true' && PLANS[id].purchasable);

  const features = (p: PlanDef) => [
    t('featPosts', { count: nf.format(p.limits.postsPerMonth) }),
    t('featTokens', { count: Math.round(p.limits.tokensPerMonth / 1_000_000) }),
    t('featSites', { count: p.limits.maxSites }),
    t('featAutopilots', { count: p.limits.maxAutopilots }),
    ...(p.limits.byokAllowed ? [t('featByok')] : []),
  ];

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />

      {params.checkout === 'success' ? (
        <div className="border-primary/30 bg-primary/5 text-foreground mb-6 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm">
          <CheckCircle2 className="text-primary size-4 shrink-0" />
          {t('checkoutSuccess')}
        </div>
      ) : params.checkout === 'cancelled' ? (
        <div className="border-border bg-muted/50 text-muted-foreground mb-6 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm">
          <CircleAlert className="size-4 shrink-0" />
          {t('checkoutCancelled')}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              {t('currentPlan')}
              {sub && statusLabel[sub.status] ? (
                <Badge variant={sub.status === 'active' || sub.status === 'trialing' ? 'secondary' : 'destructive'}>
                  {statusLabel[sub.status]}
                </Badge>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold">{planName(plan.id)}</span>
              {plan.priceUsd !== null && plan.priceUsd > 0 ? (
                <span className="text-muted-foreground text-sm">
                  {money.format(plan.priceUsd)}
                  {t('perMonth')}
                </span>
              ) : null}
            </div>
            {sub?.currentPeriodEnd && plan.id !== 'free' && !isUnlimited ? (
              <p className="text-muted-foreground text-sm">
                {sub.cancelAtPeriodEnd
                  ? t('cancelsOn', { date: dateFmt.format(sub.currentPeriodEnd) })
                  : t('renewsOn', { date: dateFmt.format(sub.currentPeriodEnd) })}
              </p>
            ) : null}
            {plan.id === 'free' ? <p className="text-muted-foreground text-sm">{t('freePlanHint')}</p> : null}
            {sub?.stripeCustomerId ? <ManageSubscriptionButton label={t('manageSubscription')} /> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('usageTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span>{t('postsUsed')}</span>
                <span className="text-muted-foreground">
                  {t('ofLimit', { used: nf.format(usage.postsCreated), limit: fmtLimit(postsLimit) })}
                </span>
              </div>
              {!isUnlimited && !byokLifted ? <UsageBar used={usage.postsCreated} limit={postsLimit} /> : null}
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span>{t('tokensUsed')}</span>
                <span className="text-muted-foreground">
                  {t('ofLimit', { used: nf.format(usage.tokensUsed), limit: fmtLimit(tokensLimit) })}
                </span>
              </div>
              {!isUnlimited && !byokLifted ? <UsageBar used={usage.tokensUsed} limit={tokensLimit} /> : null}
            </div>
            <div className="flex items-center justify-between border-t pt-3 text-sm">
              <span>{t('estimatedCost')}</span>
              <span className="font-medium">{money.format(usage.costUsd)}</span>
            </div>
            {byokLifted ? (
              <p className="text-muted-foreground text-sm">
                {t('byokNoUsageLimits', {
                  sites: plan.limits.maxSites,
                  autopilots: plan.limits.maxAutopilots,
                })}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {purchasable.length > 0 && !isUnlimited && role !== 'admin' ? (
        <div className="mt-6">
          {!stripeReady ? (
            <p className="text-muted-foreground text-sm">{t('notConfigured')}</p>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              {purchasable.map((id) => {
                const p = PLANS[id];
                const isCurrent = plan.id === id;
                const highlight = id === 'pro';
                return (
                  <Card key={id} className={highlight ? 'border-primary/40' : undefined}>
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between text-base">
                        <span className="flex items-center gap-2">
                          {highlight ? <Sparkles className="text-primary size-4" /> : null}
                          {planName(id)}
                        </span>
                        <span className="text-muted-foreground text-sm font-normal">
                          {money.format(p.priceUsd ?? 0)}
                          {t('perMonth')}
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <ul className="space-y-1.5 text-sm">
                        {features(p).map((f) => (
                          <li key={f} className="flex items-center gap-2">
                            <CheckCircle2 className="text-primary size-3.5 shrink-0" />
                            {f}
                          </li>
                        ))}
                      </ul>
                      {isCurrent ? (
                        <Badge variant="secondary">{t('currentPlanBadge')}</Badge>
                      ) : (
                        <UpgradeButton plan={id} label={t('upgradeTo', { plan: planName(id) })} highlight={highlight} />
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}
