/**
 * Planos do produto SaaS (Fase 5). Os limites vivem AQUI (código), não no
 * banco — o banco (`subscriptions`) guarda só qual plano o workspace tem.
 * `unlimited` representa isenção de cotas, nunca acesso a chaves do sistema.
 *
 * BYOK (bring your own key) = o workspace pode cadastrar chaves próprias de
 * IA/busca em qualquer plano. Chaves do sistema são exclusivas do proprietário
 * da instalação (ADMIN_EMAIL); essa autorização não é um recurso de plano.
 *
 * Os limites se dividem em dois grupos, e a diferença importa:
 *  - CONSUMO (postsPerMonth, tokensPerMonth) mede o que a plataforma financia.
 *    Some para quem traz a própria chave — ver `withByokConsumption`.
 *  - ESTRUTURAL (maxSites, maxAutopilots) mede o que roda no nosso worker.
 *    Vale para todo mundo, BYOK ou não.
 */

export type PlanId = 'free' | 'starter' | 'pro' | 'unlimited';

export interface PlanLimits {
  /** CONSUMO: posts novos criados por mês (manual ou autopilot). */
  postsPerMonth: number;
  /** CONSUMO: tokens LLM (entrada+saída) por mês, somando todas as chamadas. */
  tokensPerMonth: number;
  /** ESTRUTURAL: sites WordPress conectados. */
  maxSites: number;
  /** ESTRUTURAL: configurações de Autopilot ativas. */
  maxAutopilots: number;
  /** Pode cadastrar chaves próprias de IA/busca (BYOK). */
  byokAllowed: boolean;
}

export interface PlanDef {
  id: PlanId;
  /** Preço mensal em USD só para exibição; a cobrança real vem do Stripe. */
  priceUsd: number | null;
  limits: PlanLimits;
  /** Comprável via checkout (free e unlimited não são). */
  purchasable: boolean;
}

const M = 1_000_000;

export const PLANS: Record<PlanId, PlanDef> = {
  free: {
    id: 'free',
    priceUsd: 0,
    purchasable: false,
    limits: {
      postsPerMonth: 5,
      tokensPerMonth: 1 * M,
      maxSites: 1,
      maxAutopilots: 1,
      byokAllowed: true,
    },
  },
  starter: {
    id: 'starter',
    priceUsd: 29,
    purchasable: true,
    limits: {
      postsPerMonth: 30,
      tokensPerMonth: 6 * M,
      maxSites: 2,
      maxAutopilots: 2,
      byokAllowed: true,
    },
  },
  pro: {
    id: 'pro',
    priceUsd: 99,
    purchasable: true,
    limits: {
      postsPerMonth: 150,
      tokensPerMonth: 30 * M,
      maxSites: 5,
      maxAutopilots: 5,
      byokAllowed: true,
    },
  },
  unlimited: {
    id: 'unlimited',
    priceUsd: null,
    purchasable: false,
    limits: {
      postsPerMonth: Number.MAX_SAFE_INTEGER,
      tokensPerMonth: Number.MAX_SAFE_INTEGER,
      maxSites: Number.MAX_SAFE_INTEGER,
      maxAutopilots: Number.MAX_SAFE_INTEGER,
      byokAllowed: true,
    },
  },
};

export function planById(id: string | null | undefined): PlanDef {
  return PLANS[(id ?? 'free') as PlanId] ?? PLANS.free;
}

/** Assinaturas nesses status mantêm o plano pago; fora deles cai para free. */
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

export function effectivePlan(sub: { plan: string; status: string } | null | undefined): PlanDef {
  if (!sub) return PLANS.free;
  if (!ACTIVE_STATUSES.has(sub.status)) return PLANS.free;
  return planById(sub.plan);
}

/**
 * Remove as cotas de consumo de quem paga a própria IA.
 *
 * Aplicado só nos guards de geração — `maxSites`/`maxAutopilots` continuam
 * vindo do plano cru, inclusive para BYOK, porque limitam o nosso servidor e
 * não a conta do provedor do usuário.
 */
export function withByokConsumption(plan: PlanDef, byok: boolean): PlanDef {
  if (!byok) return plan;
  return {
    ...plan,
    limits: {
      ...plan.limits,
      postsPerMonth: Number.MAX_SAFE_INTEGER,
      tokensPerMonth: Number.MAX_SAFE_INTEGER,
    },
  };
}

export class PlanLimitError extends Error {
  constructor(
    message: string,
    public readonly limit: keyof PlanLimits,
  ) {
    super(message);
    this.name = 'PlanLimitError';
  }
}
