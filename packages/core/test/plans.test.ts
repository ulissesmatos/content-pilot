import { describe, expect, it } from 'vitest';
import { effectivePlan, planById, PLANS } from '../src/billing/plans';
import { autopilotLimitsSchema, parseAutopilotLimits } from '../src/autopilot/schema';
import { rankCandidates } from '../src/images/illustrate';
import type { ImageCandidate } from '../src/images/openverse';

describe('planos (billing)', () => {
  it('sem assinatura → free', () => {
    expect(effectivePlan(null).id).toBe('free');
    expect(effectivePlan(undefined).id).toBe('free');
  });

  it('assinatura cancelada/unpaid → free (perde o pago)', () => {
    expect(effectivePlan({ plan: 'pro', status: 'canceled' }).id).toBe('free');
    expect(effectivePlan({ plan: 'starter', status: 'unpaid' }).id).toBe('free');
    expect(effectivePlan({ plan: 'starter', status: 'incomplete' }).id).toBe('free');
  });

  it('active/trialing/past_due mantêm o plano pago', () => {
    expect(effectivePlan({ plan: 'pro', status: 'active' }).id).toBe('pro');
    expect(effectivePlan({ plan: 'starter', status: 'trialing' }).id).toBe('starter');
    expect(effectivePlan({ plan: 'pro', status: 'past_due' }).id).toBe('pro');
  });

  it('plano desconhecido no banco → free (nunca lança)', () => {
    expect(planById('enterprise-legacy').id).toBe('free');
    expect(effectivePlan({ plan: 'x', status: 'active' }).id).toBe('free');
  });

  it('BYOK é recurso do pro; free/starter usam chaves da plataforma', () => {
    expect(PLANS.free.limits.byokAllowed).toBe(false);
    expect(PLANS.starter.limits.byokAllowed).toBe(false);
    expect(PLANS.pro.limits.byokAllowed).toBe(true);
    expect(PLANS.free.limits.platformKeysAllowed).toBe(true);
  });

  it('unlimited não é comprável', () => {
    expect(PLANS.unlimited.purchasable).toBe(false);
    expect(PLANS.free.purchasable).toBe(false);
  });
});

describe('autopilotLimitsSchema (kill-switches Fase 4)', () => {
  it('defaults conservadores', () => {
    const limits = parseAutopilotLimits(undefined);
    expect(limits.monthlyBudgetUsd).toBe(20);
    expect(limits.maxPostsPerDay).toBe(5);
    expect(limits.generationTokenBudget).toBe(300_000);
  });

  it('rejeita orçamento não-positivo', () => {
    expect(() => autopilotLimitsSchema.parse({ monthlyBudgetUsd: 0 })).toThrow();
    expect(() => autopilotLimitsSchema.parse({ monthlyBudgetUsd: -5 })).toThrow();
  });

  it('rejeita maxPostsPerDay fora da faixa', () => {
    expect(() => autopilotLimitsSchema.parse({ maxPostsPerDay: 0 })).toThrow();
    expect(() => autopilotLimitsSchema.parse({ maxPostsPerDay: 51 })).toThrow();
  });
});

describe('rankCandidates (pré-rank determinístico de imagens)', () => {
  const img = (title: string): ImageCandidate => ({
    url: `https://img/${title}`,
    thumbnail: `https://thumb/${title}`,
    title,
    license: 'CC BY 4.0',
    attribution: 'x',
    sourcePage: 'https://page',
    provider: 'openverse',
  });

  it('prioriza títulos com sobreposição de tokens com o tema', () => {
    const pool = [img('gato preto dormindo'), img('Blox Fruits gameplay screenshot'), img('paisagem de montanha')];
    const top = rankCandidates(pool, { topic: 'Códigos Blox Fruits julho', keywords: ['blox fruits codes'] }, 2);
    expect(top.length).toBe(2);
    expect(top[0]!.title).toContain('Blox Fruits');
  });

  it('não corta quando o pool já é pequeno', () => {
    const pool = [img('a'), img('b')];
    expect(rankCandidates(pool, { topic: 'x', keywords: [] }, 5)).toHaveLength(2);
  });

  it('empate preserva a ordem do provedor (relevância da busca)', () => {
    const pool = [img('primeira sem relação'), img('segunda sem relação'), img('terceira sem relação')];
    const top = rankCandidates(pool, { topic: 'tema qualquer', keywords: [] }, 2);
    expect(top.map((c) => c.title)).toEqual(['primeira sem relação', 'segunda sem relação']);
  });
});
