/**
 * Preços por 1M de tokens (USD) para estimar o custo de cada chamada.
 *
 * A fonte preferida é o catálogo sincronizado dos provedores, passado em
 * `prices`. A tabela fixa abaixo é só a reserva de quando o catálogo ainda
 * não foi sincronizado — ela cobre poucos modelos, e modelo fora dela
 * devolvia null, o que virava `cost_estimate_usd = NULL` no banco e deixava
 * o gasto invisível justamente nos modelos novos.
 *
 * null continua significando "custo desconhecido", nunca zero.
 */

export type PriceTable = Record<string, { input: number; output: number }>;

const FALLBACK_PRICES: PriceTable = {
  // Anthropic
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-4-5-20250929': { input: 3, output: 15 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-opus-4-8': { input: 10, output: 40 },
  // OpenAI (aproximado)
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1': { input: 2, output: 8 },
};

/** Ids do OpenRouter são "vendor/model"; os nativos são secos. */
function lookup(table: PriceTable, model: string) {
  return table[model] ?? table[model.split('/').pop() ?? model];
}

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  prices?: PriceTable,
): number | null {
  const price = (prices ? lookup(prices, model) : undefined) ?? lookup(FALLBACK_PRICES, model);
  if (!price) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
