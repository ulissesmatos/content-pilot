/**
 * Planos do produto SaaS (Fase 5). Os limites vivem AQUI (código), não no
 * banco — o banco (`subscriptions`) guarda só qual plano o workspace tem.
 * `unlimited` é interno (admins da plataforma), nunca comprável.
 *
 * BYOK (bring your own key) = o workspace pode cadastrar chaves próprias de
 * IA/busca. Sem BYOK, o workspace usa as chaves da plataforma (credenciais
 * globais com workspace NULL) e os limites de tokens protegem o custo.
 */

export type PlanId = 'free' | 'starter' | 'pro' | 'unlimited';

export interface PlanLimits {
  /** Posts novos criados por mês (geração de pautas, manual ou autopilot). */
  postsPerMonth: number;
  /** Tokens LLM (entrada+saída) por mês, somando todas as chamadas. */
  tokensPerMonth: number;
  /** Sites WordPress conectados. */
  maxSites: number;
  /** Configurações de Autopilot ativas. */
  maxAutopilots: number;
  /** Pode cadastrar chaves próprias de IA/busca (BYOK). */
  byokAllowed: boolean;
  /** Pode usar as chaves globais da plataforma como fallback. */
  platformKeysAllowed: boolean;
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
      byokAllowed: false,
      platformKeysAllowed: true,
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
      byokAllowed: false,
      platformKeysAllowed: true,
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
      platformKeysAllowed: true,
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
      platformKeysAllowed: true,
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

export class PlanLimitError extends Error {
  constructor(
    message: string,
    public readonly limit: keyof PlanLimits,
  ) {
    super(message);
    this.name = 'PlanLimitError';
  }
}
