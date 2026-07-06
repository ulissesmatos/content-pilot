/**
 * Preços por 1M de tokens (USD) para estimativa de custo no dashboard.
 * Valores aproximados — atualizar quando os provedores mudarem tabela.
 * Modelos fora da tabela retornam null (custo desconhecido, não zero).
 */
const PRICES: Record<string, { input: number; output: number }> = {
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

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  // OpenRouter usa ids "vendor/model" — tenta o sufixo na tabela
  const key = PRICES[model] ? model : (model.split('/').pop() ?? model);
  const price = PRICES[key];
  if (!price) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
