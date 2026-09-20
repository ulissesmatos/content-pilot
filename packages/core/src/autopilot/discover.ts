import { extractJson } from '../llm/parse';
import { LlmError } from '../llm/client';
import type { LlmProvider } from '../llm/types';
import type { SearchClient } from '../search/tavily';
import { monthYear, todayLong } from '../i18n/dates';
import { LANGUAGE_NAMES, rewriteDashesInText, stripDecorativeDates } from '../text/style-guard';
import { stripDiacritics } from '../i18n/slug';
import { BudgetExceededError, type LlmCallRecord } from '../pipeline/types';
import {
  buildDedupeResponseSchema,
  buildDiscoveryResponseSchema,
  CONTENT_TYPES,
  type ContentType,
  type DiscoveryCandidate,
} from './schema';

/**
 * Descoberta autônoma de temas (Fase 1 do Autopilot).
 *
 * Fluxo: busca de tendências no nicho → 1 chamada LLM classifica candidatos →
 * dedup em 2 camadas (determinística por similaridade de título + LLM semântico)
 * contra o que já foi publicado. Cada passo é uma chamada estruturada pequena e
 * de propósito único — o que faz funcionar em mini-modelos (gpt-4.1-mini/haiku).
 *
 * Princípio fail-safe: o LLM propõe, mas a dedup determinística sempre roda
 * antes e sozinha já barra as duplicatas óbvias; na dúvida, descarta.
 */

const STOPWORDS = new Set([
  'a', 'o', 'os', 'as', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'nos', 'nas',
  'um', 'uma', 'para', 'por', 'com', 'que', 'como', 'the', 'of', 'to', 'in', 'on', 'for', 'and',
  'codigos', 'codigo', 'codes', 'code',
]);

/** Tokens significativos de um título, normalizados (minúsculo, sem acento, sem stopword). */
export function titleTokens(title: string): Set<string> {
  const norm = stripDiacritics(title.toLowerCase()).replace(/[^a-z0-9\s]/g, ' ');
  const tokens = norm.split(/\s+/).filter((t) => t.length > 2 && !STOPWORDS.has(t));
  return new Set(tokens);
}

/** Similaridade de Jaccard entre dois conjuntos de tokens (0..1). */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Duplicata determinística: true se o tema for muito parecido com algum título
 * existente (Jaccard >= threshold). Barra os casos óbvios antes de gastar LLM.
 */
export function isNearDuplicate(topic: string, existingTitles: string[], threshold = 0.6): string | null {
  const topicTokens = titleTokens(topic);
  for (const title of existingTitles) {
    const sim = jaccard(topicTokens, titleTokens(title));
    if (sim >= threshold) return title;
  }
  return null;
}

/**
 * Maior similaridade de Jaccard entre um tema e a lista de títulos existentes.
 * Usada para decidir se o candidato precisa do dedup semântico (LLM): abaixo
 * da banda de incerteza ele é claramente novo e nem gasta a chamada.
 */
export function maxSimilarity(topic: string, existingTitles: string[]): number {
  const topicTokens = titleTokens(topic);
  let max = 0;
  for (const title of existingTitles) {
    const sim = jaccard(topicTokens, titleTokens(title));
    if (sim > max) max = sim;
  }
  return max;
}

/**
 * Banda de incerteza do dedup: candidatos com similaridade máxima abaixo disso
 * são novos com certeza (auto-keep, sem LLM); acima de 0.6 o determinístico já
 * descartou. Só o meio-termo justifica a chamada semântica.
 */
export const DEDUPE_UNCERTAIN_MIN = 0.25;

/** Só os títulos minimamente parecidos com algum candidato entram no prompt de dedup. */
export function relevantTitlesFor(candidates: DiscoveryCandidate[], existingTitles: string[], cap = 150): string[] {
  const tokenSets = candidates.map((c) => titleTokens(c.topic));
  const scored: Array<{ title: string; sim: number }> = [];
  for (const title of existingTitles) {
    const tTokens = titleTokens(title);
    let best = 0;
    for (const cTokens of tokenSets) {
      const sim = jaccard(cTokens, tTokens);
      if (sim > best) best = sim;
    }
    if (best >= 0.1) scored.push({ title, sim: best });
  }
  return scored
    .sort((a, b) => b.sim - a.sim)
    .slice(0, cap)
    .map((s) => s.title);
}

export interface DiscoveryDeps {
  search: SearchClient;
  llmDiscover: LlmProvider;
  now?: () => Date;
  checkBudget?: () => Promise<void> | void;
  log?: (msg: string) => void;
}

export interface DiscoveryInput {
  /** Tópicos-semente do nicho (ex.: ["Roblox codes", "jogos mobile"]). */
  seedTopics: string[];
  language: string;
  siteName?: string;
  /** Títulos de posts já publicados + pautas existentes, para o dedup. */
  existingTitles: string[];
  /** Máximo de temas a manter após o dedup. */
  postsPerCycle: number;
  /** Tipos permitidos (vazio = todos). */
  allowedTypes?: ContentType[];
  discoverMaxTokens?: number;
  /**
   * Não pôr data/mês/ano nos temas e títulos. Padrão: true. Só templates cujo
   * nicho usa data como convenção (ex.: códigos de jogos) devem desligar.
   */
  avoidDates?: boolean;
}

export interface DiscardedTopic {
  topic: string;
  reason: string;
}

export interface DiscoveryResult {
  status: 'ok' | 'no_candidates' | 'llm_failed' | 'budget_exceeded';
  kept: DiscoveryCandidate[];
  discarded: DiscardedTopic[];
  queries: string[];
  sourcesCount: number;
  llmCalls: LlmCallRecord[];
  skipReason: string | null;
}

/** Queries de tendência por semente e locale. */
export function buildDiscoveryQueries(seedTopics: string[], language: string, now: Date): string[] {
  const my = monthYear(language, now);
  const isPt = language.toLowerCase().startsWith('pt');
  const queries: string[] = [];
  for (const seed of seedTopics.slice(0, 5)) {
    const s = seed.trim();
    if (!s) continue;
    if (isPt) {
      queries.push(`${s} novidades e tendências ${my}`);
      queries.push(`${s} o que as pessoas estão pesquisando ${my}`);
    } else {
      queries.push(`${s} trending news ${my}`);
      queries.push(`${s} what people are searching ${my}`);
    }
  }
  return queries;
}

/** Regra de datas para o prompt. Vazia quando o nicho usa data de propósito. */
function dateRule(input: DiscoveryInput, pt: boolean): string {
  if (input.avoidDates === false) return '';
  return pt
    ? `\n- NÃO ponha data, dia, mês nem ano no tema nem no título sugerido (nada de "(20/09/2026)" ou "de setembro de 2026"). Não use travessão.`
    : `\n- Do NOT put a date, day, month or year in the topic or suggested title (no "(09/20/2026)" or "September 2026"). Do not use em or en dashes.`;
}

function buildDiscoveryPrompt(input: DiscoveryInput, searchContext: string, language: string, now: Date): string {
  const isPt = language.toLowerCase().startsWith('pt');
  const typeList = (input.allowedTypes?.length ? input.allowedTypes : CONTENT_TYPES).join(', ');
  const site = input.siteName ? ` do blog "${input.siteName}"` : '';
  const seeds = input.seedTopics.join(', ');

  if (isPt) {
    return `Você é um editor-chefe${site} planejando a pauta de conteúdo.
Hoje é ${todayLong(language, now)}. Nicho/temas do blog: ${seeds}.

RESULTADOS DA BUSCA WEB (tendências e assuntos recentes do nicho):
${searchContext || '(nenhum resultado)'}

TAREFA: proponha até ${Math.max(input.postsPerCycle * 3, 6)} temas de artigo NOVOS e relevantes para esse nicho, baseados no que está em alta nas fontes acima. Para cada tema escolha o tipo mais adequado entre: ${typeList}.

REGRAS:
- Temas específicos e pesquisáveis (não "novidades de games", mas "o que muda no sistema de amigos do [jogo X]").${dateRule(input, true)}
- Prefira o que aparece com força nas fontes (sinais de interesse real do público).
- Não repita o mesmo assunto em candidatos diferentes.

RESPONDA EXATAMENTE NESTE FORMATO JSON (use estes nomes de campo, sem markdown):
{
  "candidates": [
    {
      "topic": "tema específico e pesquisável",
      "contentType": "um de: ${typeList}",
      "keywords": ["2-5 termos de busca reais"],
      "angle": "gancho editorial em 1 frase",
      "suggestedTitle": "título SEO com a keyword principal"
    }
  ]
}`;
  }

  return `You are an editor-in-chief${site} planning the content calendar.
Today is ${todayLong(language, now)}. Blog niche/topics: ${seeds}.

WEB SEARCH RESULTS (recent trends and hot topics in the niche):
${searchContext || '(no results)'}

TASK: propose up to ${Math.max(input.postsPerCycle * 3, 6)} NEW, relevant article topics for this niche, based on what is trending in the sources above. For each, pick the best type among: ${typeList}.

RULES:
- Specific, searchable topics (not "gaming news" but "what changes in [game X]'s friends system").${dateRule(input, false)}
- Prefer what shows strong signal in the sources (real audience interest).
- Do not repeat the same subject across candidates.
- Write "topic", "angle" and "suggestedTitle" in ${LANGUAGE_NAMES[language] ?? language} — even if the sources above are in another language.

RESPOND EXACTLY IN THIS JSON FORMAT (use these field names, no markdown):
{
  "candidates": [
    {
      "topic": "specific, searchable topic",
      "contentType": "one of: ${typeList}",
      "keywords": ["2-5 real search terms"],
      "angle": "editorial hook in one sentence",
      "suggestedTitle": "SEO title with the main keyword"
    }
  ]
}`;
}

function buildDedupePrompt(candidates: DiscoveryCandidate[], existingTitles: string[], language: string): string {
  const isPt = language.toLowerCase().startsWith('pt');
  const candJson = JSON.stringify(
    candidates.map((c, i) => ({ index: i, topic: c.topic, suggestedTitle: c.suggestedTitle })),
    null,
    2,
  );
  const titles = existingTitles.slice(0, 300).map((t) => `- ${t}`).join('\n');

  if (isPt) {
    return `Você decide quais temas de artigo são NOVOS e quais já foram cobertos.

TÍTULOS JÁ PUBLICADOS/PLANEJADOS no blog:
${titles || '(nenhum)'}

TEMAS CANDIDATOS (índice + tema + título sugerido):
${candJson}

TAREFA: para CADA candidato, decida keep=true se o assunto ainda NÃO foi coberto, keep=false se já existe um post equivalente (mesmo que o título seja diferente — julgue pelo assunto). Na dúvida sobre ser duplicata, mantenha (keep=true). reason em 1 frase curta.

RESPONDA EXATAMENTE NESTE FORMATO JSON (sem markdown), com uma decisão por candidato usando o mesmo index:
{
  "decisions": [
    { "index": 0, "keep": true, "reason": "motivo curto" }
  ]
}`;
  }

  return `You decide which article topics are NEW and which are already covered.

ALREADY PUBLISHED/PLANNED titles on the blog:
${titles || '(none)'}

CANDIDATE TOPICS (index + topic + suggested title):
${candJson}

TASK: for EACH candidate, set keep=true if the subject is NOT yet covered, keep=false if an equivalent post already exists (even if the title differs — judge by subject). When unsure whether it is a duplicate, keep it (keep=true). reason in one short sentence.

RESPOND EXACTLY IN THIS JSON FORMAT (no markdown), one decision per candidate using the same index:
{
  "decisions": [
    { "index": 0, "keep": true, "reason": "short reason" }
  ]
}`;
}

/** Descoberta completa: busca → classifica → dedup determinístico + LLM. */
export async function runDiscovery(input: DiscoveryInput, deps: DiscoveryDeps): Promise<DiscoveryResult> {
  const now = deps.now?.() ?? new Date();
  const log = deps.log ?? (() => {});
  const language = input.language;
  const llmCalls: LlmCallRecord[] = [];

  const base: DiscoveryResult = {
    status: 'ok',
    kept: [],
    discarded: [],
    queries: [],
    sourcesCount: 0,
    llmCalls,
    skipReason: null,
  };

  // 1. Busca de tendências (basic — só precisamos de títulos/snippets, não raw_content pesado)
  const queries = buildDiscoveryQueries(input.seedTopics, language, now);
  base.queries = queries;
  const buckets = await Promise.all(
    queries.map(async (q) => {
      log(`descoberta [busca]: ${q}`);
      const res = await deps.search.search(q, { depth: 'basic', maxResults: 8 });
      if (res.error) log(`descoberta [busca] falhou: ${res.error}`);
      return res.results;
    }),
  );

  // Contexto enxuto: título + snippet + data, deduplicado por URL
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const results of buckets) {
    for (const r of results) {
      if (!r.url || seen.has(r.url)) continue;
      seen.add(r.url);
      const snippet = (r.content ?? '').slice(0, 300).replace(/\s+/g, ' ').trim();
      lines.push(`- ${r.title ?? '(sem título)'}${r.published_date ? ` [${r.published_date}]` : ''}: ${snippet}`);
    }
  }
  base.sourcesCount = seen.size;
  const searchContext = lines.slice(0, 60).join('\n');
  log(`descoberta: ${seen.size} fontes únicas`);

  // 2. Classificação (1 chamada LLM)
  try {
    await deps.checkBudget?.();
  } catch (err) {
    if (err instanceof BudgetExceededError) return { ...base, status: 'budget_exceeded', skipReason: err.message };
    throw err;
  }

  let candidates: DiscoveryCandidate[] = [];
  try {
    const res = await deps.llmDiscover.complete({
      prompt: buildDiscoveryPrompt(input, searchContext, language, now),
      schema: buildDiscoveryResponseSchema(),
      schemaName: 'autopilot_discover',
      maxTokens: input.discoverMaxTokens ?? 4_000,
      temperature: 0.4,
    });
    llmCalls.push(recordCall('discover', res));
    candidates = normalizeCandidates(extractJson(res.text), input.allowedTypes, input.avoidDates !== false);
  } catch (err) {
    if (err instanceof BudgetExceededError) return { ...base, status: 'budget_exceeded', skipReason: err.message };
    if (err instanceof LlmError) {
      llmCalls.push(errorCall('discover', deps.llmDiscover));
      return { ...base, status: 'llm_failed', skipReason: err.message };
    }
    throw err;
  }

  if (candidates.length === 0) return { ...base, status: 'no_candidates', skipReason: 'nenhum candidato válido' };

  // 3a. Dedup determinístico (barra duplicatas óbvias sem gastar LLM)
  const discarded: DiscardedTopic[] = [];
  const afterDeterministic: DiscoveryCandidate[] = [];
  for (const c of candidates) {
    const dup = isNearDuplicate(c.topic, input.existingTitles);
    if (dup) discarded.push({ topic: c.topic, reason: `similar a post existente: "${dup}"` });
    else afterDeterministic.push(c);
  }
  log(`dedup determinístico: ${discarded.length} descartados, ${afterDeterministic.length} restantes`);

  // 3b. Dedup semântico (LLM) SÓ na banda de incerteza: candidatos claramente
  // novos (similaridade < DEDUPE_UNCERTAIN_MIN com tudo que existe) não gastam
  // IA; se nenhum candidato for incerto, a chamada nem acontece.
  const clearlyNew: DiscoveryCandidate[] = [];
  const uncertain: DiscoveryCandidate[] = [];
  for (const c of afterDeterministic) {
    if (input.existingTitles.length > 0 && maxSimilarity(c.topic, input.existingTitles) >= DEDUPE_UNCERTAIN_MIN) {
      uncertain.push(c);
    } else {
      clearlyNew.push(c);
    }
  }

  let survivingUncertain = uncertain;
  if (uncertain.length > 0) {
    log(`dedup semântico: ${uncertain.length} candidato(s) na banda de incerteza (${clearlyNew.length} claramente novos)`);
    try {
      await deps.checkBudget?.();
      // prompt enxuto: só títulos minimamente parecidos com os candidatos incertos
      const titles = relevantTitlesFor(uncertain, input.existingTitles);
      const res = await deps.llmDiscover.complete({
        prompt: buildDedupePrompt(uncertain, titles, language),
        schema: buildDedupeResponseSchema(),
        schemaName: 'autopilot_dedupe',
        maxTokens: 2_000,
        temperature: 0,
      });
      llmCalls.push(recordCall('dedupe', res));
      const decisions = normalizeDecisions(extractJson(res.text));
      if (decisions.length > 0) {
        const decisionByIndex = new Map(decisions.map((d) => [Number(d.index), d]));
        const kept: DiscoveryCandidate[] = [];
        uncertain.forEach((c, i) => {
          const d = decisionByIndex.get(i);
          // fail-safe: sem decisão explícita = mantém (conservador só para descarte)
          if (d && d.keep === false) discarded.push({ topic: c.topic, reason: d.reason || 'já coberto' });
          else kept.push(c);
        });
        survivingUncertain = kept;
      }
      // parsed nulo = passthrough (mantém todos); a dedup determinística já filtrou
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        // orçamento estourou no dedup: segue com o resultado determinístico
        log('dedup LLM pulado: orçamento excedido');
      } else if (err instanceof LlmError) {
        llmCalls.push(errorCall('dedupe', deps.llmDiscover));
        log(`dedup LLM falhou (passthrough): ${err.message}`);
      } else {
        throw err;
      }
    }
  } else {
    log('dedup semântico: nenhum candidato incerto — chamada LLM economizada');
  }

  // preserva a ordem original dos candidatos ao juntar os dois grupos
  const survivingSet = new Set([...clearlyNew, ...survivingUncertain]);
  const surviving = afterDeterministic.filter((c) => survivingSet.has(c));

  return { ...base, kept: surviving.slice(0, input.postsPerCycle), discarded, llmCalls };
}

interface DedupeDecision {
  index: number;
  keep: boolean;
  reason: string;
}

/** Normaliza as decisões de dedup tolerando a lista sob decisions/results/items. */
function normalizeDecisions(parsed: unknown): DedupeDecision[] {
  const root = (parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}) as Record<string, unknown>;
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(root.decisions)
      ? root.decisions
      : Array.isArray(root.results)
        ? root.results
        : Array.isArray(root.items)
          ? root.items
          : [];
  const out: DedupeDecision[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const index = Number(r.index ?? r.i ?? r.id);
    if (!Number.isInteger(index)) continue;
    out.push({
      index,
      keep: r.keep !== false && r.discard !== true && r.duplicate !== true,
      reason: String(r.reason ?? r.motivo ?? '').trim(),
    });
  }
  return out;
}

const firstString = (r: Record<string, unknown>, keys: string[]): string => {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
};

/**
 * Normaliza a resposta de descoberta tolerando variações de nome de campo entre
 * modelos/provedores. Provedores em modo json_object (ex.: OpenRouter/deepseek)
 * não forçam o schema estrito, então o modelo pode nomear a lista de `topics`
 * em vez de `candidates` e o tema de `theme`/`type` — aceitamos os apelidos
 * comuns em vez de descartar candidatos perfeitamente bons.
 */
/**
 * Limpa tema/título de candidato: travessão sempre reescrito, data decorativa
 * removida quando a política pede. Guarda de código porque o prompt sozinho
 * não impediu o "(20/09/2026)" de chegar ao título do post.
 */
function makeCleaner(avoidDates: boolean) {
  return (text: string): string => {
    let t = text;
    if (avoidDates) t = stripDecorativeDates(t, { minLength: 8 }).title;
    return rewriteDashesInText(t, { title: true }).text;
  };
}

function normalizeCandidates(
  parsed: unknown,
  allowed?: ContentType[],
  avoidDates = true,
): DiscoveryCandidate[] {
  const clean = makeCleaner(avoidDates);
  const root = (parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}) as Record<string, unknown>;
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(root.candidates)
      ? root.candidates
      : Array.isArray(root.topics)
        ? root.topics
        : Array.isArray(root.items)
          ? root.items
          : Array.isArray(root.results)
            ? root.results
            : [];

  const allowSet = allowed && allowed.length ? new Set(allowed) : null;
  const out: DiscoveryCandidate[] = [];
  const seenTopics = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const topic = firstString(r, ['topic', 'theme', 'subject', 'title', 'name']);
    if (!topic || topic.length < 3) continue;
    const key = topic.toLowerCase();
    if (seenTopics.has(key)) continue;
    const rawType = firstString(r, ['contentType', 'type', 'kind', 'format']).toLowerCase();
    const contentType = (CONTENT_TYPES as readonly string[]).includes(rawType)
      ? (rawType as ContentType)
      : 'evergreen';
    if (allowSet && !allowSet.has(contentType)) continue;
    seenTopics.add(key);
    const kwRaw = (r.keywords ?? r.tags ?? r.keyphrases) as unknown;
    out.push({
      topic: clean(topic),
      contentType,
      keywords: Array.isArray(kwRaw) ? kwRaw.map((k) => String(k).trim()).filter(Boolean).slice(0, 8) : [],
      angle: firstString(r, ['angle', 'hook', 'summary', 'description']),
      suggestedTitle: clean(firstString(r, ['suggestedTitle', 'seoTitle', 'headline', 'title']) || topic),
    });
  }
  return out;
}

function recordCall(
  purpose: 'discover' | 'dedupe',
  res: { provider: string; model: string; inputTokens: number; outputTokens: number; costUsd: number | null; durationMs: number; truncated: boolean },
): LlmCallRecord {
  return {
    purpose,
    provider: res.provider,
    model: res.model,
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
    costUsd: res.costUsd,
    durationMs: res.durationMs,
    status: res.truncated ? 'truncated' : 'ok',
  };
}

function errorCall(purpose: 'discover' | 'dedupe', llm: LlmProvider): LlmCallRecord {
  return {
    purpose,
    provider: llm.provider,
    model: llm.model,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: null,
    durationMs: 0,
    status: 'error',
  };
}
