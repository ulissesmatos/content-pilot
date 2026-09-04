import { describe, expect, it } from 'vitest';
import { estimatePostCost, ESTIMATED_TOKENS_PER_POST } from '../src/llm/cost-model';
import type { PriceTable } from '../src/llm/pricing';

const PRICES: PriceTable = {
  'z-ai/glm-5.2': { input: 0.966, output: 3.036 },
  'openai/gpt-4o-mini': { input: 0.15, output: 0.6 },
};

describe('estimatePostCost', () => {
  it('soma as etapas e bate com a conta feita à mão', () => {
    const r = estimatePostCost({ generate: 'z-ai/glm-5.2' }, PRICES);
    const t = ESTIMATED_TOKENS_PER_POST.generate;
    const esperado = (t.input * 0.966 + t.output * 3.036) / 1_000_000;
    expect(r.totalUsd).toBeCloseTo(esperado, 8);
    expect(r.unknown).toEqual([]);
  });

  it('marca a etapa sem preço em vez de contá-la como zero', () => {
    const r = estimatePostCost(
      { generate: 'z-ai/glm-5.2', illustrate: 'modelo/desconhecido' },
      PRICES,
    );
    expect(r.unknown).toEqual(['illustrate']);
    // o total só soma o que tem preço — e a UI mostra o aviso
    expect(r.perPurpose.find((p) => p.purpose === 'illustrate')!.costUsd).toBeNull();
  });

  it('perfil mais caro custa mais que o barato — é o que o painel precisa mostrar', () => {
    const barato = estimatePostCost({ generate: 'openai/gpt-4o-mini' }, PRICES);
    const caro = estimatePostCost({ generate: 'z-ai/glm-5.2' }, PRICES);
    expect(caro.totalUsd).toBeGreaterThan(barato.totalUsd);
  });

  it('sem modelo algum, custo zero e nada desconhecido', () => {
    expect(estimatePostCost({}, PRICES)).toEqual({ perPurpose: [], totalUsd: 0, unknown: [] });
  });
});
