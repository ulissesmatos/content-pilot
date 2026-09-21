import { extractJson } from '../llm/parse';
import { LlmError } from '../llm/client';
import type { LlmProvider } from '../llm/types';
import { BudgetExceededError, type LlmCallRecord } from '../pipeline/types';
import { buildDedupeResponseSchema } from './schema';
import { isNearDuplicate, maxSimilarity, relevantTitlesFor, titleTokens, jaccard } from './discover';

/**
 * Guard anti-repetição na GERAÇÃO (não só na descoberta): antes de gastar
 * pesquisa + LLM gerando um post, verifica se o tema já foi coberto — títulos
 * dos posts do WP + pautas do workspace. Duas camadas, mesma filosofia do
 * Autopilot: Jaccard determinístico barra o óbvio; a banda de incerteza vai
 * para 1 chamada LLM pequena. Fail-open: erro na camada semântica não bloqueia
 * a geração (melhor arriscar repetir do que nunca publicar).
 */

/** Similaridade mínima para justificar a checagem semântica (mesma banda do dedup do Autopilot). */
export const TOPIC_GUARD_SEMANTIC_MIN = 0.25;

export interface TopicGuardInput {
  topic: string;
  existingTitles: string[];
  language: string;
}

export interface TopicGuardDeps {
  /** Modelo para a checagem semântica (opcional — sem ele, só a determinística roda). */
  llm?: LlmProvider;
  checkBudget?: () => Promise<void> | void;
  log?: (msg: string) => void;
}

export interface TopicGuardResult {
  covered: boolean;
  /** Título existente mais parecido com o tema (quando covered). */
  matchedTitle: string | null;
  method: 'deterministic' | 'semantic' | null;
  llmCalls: LlmCallRecord[];
}

function mostSimilarTitle(topic: string, titles: string[]): string | null {
  const tTokens = titleTokens(topic);
  let best: string | null = null;
  let bestSim = 0;
  for (const title of titles) {
    const sim = jaccard(tTokens, titleTokens(title));
    if (sim > bestSim) {
      bestSim = sim;
      best = title;
    }
  }
  return best;
}

function buildGuardPrompt(topic: string, titles: string[], language: string): string {
  const isPt = language.toLowerCase().startsWith('pt');
  const list = titles.map((t) => `- ${t}`).join('\n');
  if (isPt) {
    return `Você decide se um tema de artigo JÁ FOI coberto pelo blog.

TÍTULOS JÁ PUBLICADOS/PLANEJADOS:
${list || '(nenhum)'}

TEMA CANDIDATO (índice 0): "${topic}"

TAREFA: keep=true se o assunto ainda NÃO foi coberto; keep=false se já existe um post equivalente (mesmo com título diferente — julgue pelo assunto). Na dúvida, keep=true. reason em 1 frase.

RESPONDA EXATAMENTE NESTE FORMATO JSON (sem markdown):
{ "decisions": [ { "index": 0, "keep": true, "reason": "motivo curto" } ] }`;
  }
  return `You decide whether an article topic has ALREADY been covered by the blog.

ALREADY PUBLISHED/PLANNED titles:
${list || '(none)'}

CANDIDATE TOPIC (index 0): "${topic}"

TASK: keep=true if the subject is NOT yet covered; keep=false if an equivalent post already exists (even with a different title — judge by subject). When unsure, keep=true. reason in one short sentence.

RESPOND EXACTLY IN THIS JSON FORMAT (no markdown):
{ "decisions": [ { "index": 0, "keep": true, "reason": "short reason" } ] }`;
}

export async function checkTopicAlreadyCovered(
  input: TopicGuardInput,
  deps: TopicGuardDeps = {},
): Promise<TopicGuardResult> {
  const log = deps.log ?? (() => {});
  const llmCalls: LlmCallRecord[] = [];
  const base: TopicGuardResult = { covered: false, matchedTitle: null, method: null, llmCalls };
  if (input.existingTitles.length === 0 || !input.topic.trim()) return base;

  // Camada 1: determinística (Jaccard) — barra duplicatas óbvias sem gastar IA.
  const dup = isNearDuplicate(input.topic, input.existingTitles);
  if (dup) {
    log(`anti-repetição: tema muito similar a "${dup}" (determinístico)`);
    return { ...base, covered: true, matchedTitle: dup, method: 'deterministic' };
  }

  // Camada 2: semântica, só na banda de incerteza (economiza a chamada nos claramente novos).
  const similarity = maxSimilarity(input.topic, input.existingTitles);
  if (!deps.llm || similarity < TOPIC_GUARD_SEMANTIC_MIN) return base;

  const titles = relevantTitlesFor(
    [{ topic: input.topic, contentType: 'evergreen', keywords: [], angle: '', suggestedTitle: input.topic, evidenceQuote: '' }],
    input.existingTitles,
    60,
  );

  try {
    await deps.checkBudget?.();
    const res = await deps.llm.complete({
      prompt: buildGuardPrompt(input.topic, titles, input.language),
      schema: buildDedupeResponseSchema(),
      schemaName: 'topic_guard_dedupe',
      maxTokens: 500,
      temperature: 0,
    });
    llmCalls.push({
      purpose: 'dedupe',
      provider: res.provider,
      model: res.model,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      costUsd: res.costUsd,
      durationMs: res.durationMs,
      status: res.truncated ? 'truncated' : 'ok',
    });
    const parsed = extractJson(res.text) as { decisions?: Array<{ keep?: unknown; reason?: unknown }> } | null;
    const decision = parsed && Array.isArray(parsed.decisions) ? parsed.decisions[0] : null;
    if (decision && decision.keep === false) {
      const matched = mostSimilarTitle(input.topic, titles) ?? mostSimilarTitle(input.topic, input.existingTitles);
      log(`anti-repetição: tema já coberto segundo o LLM (${String(decision.reason ?? '')})`);
      return { ...base, covered: true, matchedTitle: matched, method: 'semantic' };
    }
  } catch (err) {
    // Fail-open: orçamento/LLM fora do ar não bloqueia a geração.
    if (err instanceof BudgetExceededError) {
      log('anti-repetição: checagem semântica pulada (orçamento excedido)');
    } else if (err instanceof LlmError) {
      llmCalls.push({
        purpose: 'dedupe',
        provider: deps.llm.provider,
        model: deps.llm.model,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: null,
        durationMs: 0,
        status: 'error',
      });
      log(`anti-repetição: checagem semântica falhou (${err.message}) — seguindo com a geração`);
    } else {
      throw err;
    }
  }
  return base;
}
