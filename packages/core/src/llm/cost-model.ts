import { estimateCostUsd, type PriceTable } from './pricing';
import { LLM_PURPOSES, type LlmPurpose } from './purposes';

/**
 * Estimativa de tokens por post gerado, por etapa do pipeline.
 *
 * Serve ao painel: ao trocar o modelo de um perfil, o admin precisa ver o
 * impacto em dinheiro ANTES de salvar. Sem isso é fácil escolher um modelo
 * que consome mais em IA do que a mensalidade do plano — e só descobrir no
 * fim do mês.
 *
 * Os números vêm da medição do pipeline (contexto de pesquisa grande na
 * geração, artigo + regras na verificação, descoberta e dedupe amortizados no
 * ciclo do autopilot). São ordem de grandeza, não contabilidade: o custo real
 * medido fica em `llm_calls`.
 */
export const ESTIMATED_TOKENS_PER_POST: Record<LlmPurpose, { input: number; output: number }> = {
  generate: { input: 25_000, output: 6_000 },
  verify: { input: 12_000, output: 2_000 },
  discover: { input: 4_000, output: 800 },
  dedupe: { input: 1_500, output: 200 },
  // visão roda por slot (capa + imagens do corpo), cada chamada com várias miniaturas
  illustrate: { input: 6_000, output: 1_200 },
  // o revisor relê o artigo e devolve o HTML inteiro revisado
  review: { input: 10_000, output: 6_000 },
};

export interface PostCostBreakdown {
  perPurpose: Array<{ purpose: LlmPurpose; model: string; costUsd: number | null }>;
  /** Soma das etapas com preço conhecido. */
  totalUsd: number;
  /** Etapas cujo modelo não tem preço no catálogo — o total está subestimado. */
  unknown: LlmPurpose[];
}

/**
 * Custo estimado de IA para produzir um post com os modelos informados.
 * Não inclui busca (Tavily), que é cobrada por consulta e pesa tanto quanto o
 * modelo quando ele é barato.
 */
export function estimatePostCost(
  modelsByPurpose: Partial<Record<LlmPurpose, string>>,
  prices: PriceTable,
): PostCostBreakdown {
  const perPurpose: PostCostBreakdown['perPurpose'] = [];
  const unknown: LlmPurpose[] = [];
  let totalUsd = 0;

  for (const purpose of LLM_PURPOSES) {
    const model = modelsByPurpose[purpose];
    if (!model) continue;
    const tokens = ESTIMATED_TOKENS_PER_POST[purpose];
    const costUsd = estimateCostUsd(model, tokens.input, tokens.output, prices);
    perPurpose.push({ purpose, model, costUsd });
    if (costUsd === null) unknown.push(purpose);
    else totalUsd += costUsd;
  }

  return { perPurpose, totalUsd, unknown };
}
