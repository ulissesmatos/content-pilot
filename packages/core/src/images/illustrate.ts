import { extractJson } from '../llm/parse';
import { LlmError } from '../llm/client';
import { stripDiacritics } from '../i18n/slug';
import type { JsonSchema, LlmProvider } from '../llm/types';
import { BudgetExceededError, type LlmCallRecord } from '../pipeline/types';
import type { ImageCandidate, ImageSearchClient } from './openverse';

/**
 * Ilustração de artigo (Fase 3): busca imagens (web + acervo aberto), mostra as
 * candidatas para um LLM com visão escolher a capa e as imagens do corpo do
 * texto (ou nenhuma) e gera alt text de cada uma. Fail-safe: se nada for
 * relevante, o post sai sem imagem — nunca uma imagem errada.
 * Funciona em modelos com visão baratos (gpt-4.1-mini, claude-haiku).
 */

export interface ChosenImage extends ImageCandidate {
  alt: string;
}

export interface IllustrateInput {
  topic: string;
  keywords: string[];
  language: string;
  /** Quantas candidatas buscar/mostrar ao modelo (default 5). */
  maxCandidates?: number;
  /** Quantas imagens para o corpo do texto além da capa (default 0 = só capa). */
  inlineCount?: number;
  imageMaxTokens?: number;
}

export interface IllustrateDeps {
  images: ImageSearchClient;
  llmVision: LlmProvider;
  checkBudget?: () => Promise<void> | void;
  log?: (msg: string) => void;
}

export interface IllustrateResult {
  status: 'ok' | 'no_candidates' | 'none_relevant' | 'llm_failed' | 'budget_exceeded';
  /** Imagem destacada (capa) — null quando nenhuma candidata serviu. */
  cover: ChosenImage | null;
  /** Imagens escolhidas para o corpo do texto (podem existir mesmo sem capa). */
  inline: ChosenImage[];
  candidatesCount: number;
  llmCalls: LlmCallRecord[];
}

function buildQuery(input: IllustrateInput): string {
  // keywords são termos de busca limpos → melhores para imagem que o tópico
  // (que pode ter subtítulo/pontuação). Fallback: tópico até o 1º separador.
  if (input.keywords.length > 0) return input.keywords.slice(0, 2).join(' ').slice(0, 120);
  return (input.topic.split(/[:\-–|]/)[0] ?? input.topic).trim().slice(0, 120);
}

const normalizeText = (s: string) => stripDiacritics(s.toLowerCase()).replace(/[^a-z0-9\s]/g, ' ');

/**
 * Pré-rank determinístico (economia de IA): pontua candidatas pela sobreposição
 * de tokens entre título da imagem e tópico/keywords do artigo, e manda para o
 * modelo de visão só as mais promissoras. Buscamos um pool maior no Openverse
 * (grátis) e reduzimos aqui — mesma quantidade de imagens na chamada de visão,
 * pool de melhor qualidade. A decisão final continua sendo da visão (fail-safe).
 */
export function rankCandidates(
  candidates: ImageCandidate[],
  input: Pick<IllustrateInput, 'topic' | 'keywords'>,
  keep: number,
): ImageCandidate[] {
  if (candidates.length <= keep) return candidates;
  const refTokens = new Set(
    normalizeText([input.topic, ...input.keywords].join(' '))
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
  const scored = candidates.map((c, i) => {
    const titleTokensList = normalizeText(c.title).split(/\s+/).filter((t) => t.length > 2);
    let overlap = 0;
    for (const t of titleTokensList) if (refTokens.has(t)) overlap++;
    return { c, i, score: overlap };
  });
  // ordena por relevância, empate mantém a ordem do provedor (já é por relevância da busca)
  return scored
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, keep)
    .map((s) => s.c);
}

function buildResponseSchema(): JsonSchema {
  const pick = {
    type: 'object',
    properties: {
      index: { type: 'integer', description: 'Índice (base 0) da imagem escolhida.' },
      alt: { type: 'string', description: 'Texto alternativo descritivo e específico da imagem.' },
    },
    required: ['index', 'alt'],
    additionalProperties: false,
  };
  return {
    type: 'object',
    properties: {
      cover: {
        ...pick,
        description: 'Imagem de capa do artigo. index = -1 se NENHUMA candidata serve como capa.',
      },
      inline: {
        type: 'array',
        items: pick,
        description: 'Imagens para o corpo do texto (índices diferentes da capa). Lista vazia se nenhuma ajudar.',
      },
      reason: { type: 'string' },
    },
    required: ['cover', 'inline', 'reason'],
    additionalProperties: false,
  };
}

function buildPrompt(input: IllustrateInput, candidates: ImageCandidate[], inlineCount: number): string {
  const isPt = input.language.toLowerCase().startsWith('pt');
  const list = candidates
    .map((c, i) => `${i}: ${c.title || '(sem título)'}`)
    .join('\n');
  if (isPt) {
    return `Você é o editor de imagens de um artigo de blog sobre "${input.topic}".

As imagens candidatas estão anexadas nesta ordem (índice: título):
${list}

TAREFAS:
1. CAPA: escolha a MELHOR imagem de capa. Critérios rígidos: mostra o assunto do artigo em si (não algo apenas vagamente relacionado, como um componente ou acessório quando o tema é o produto), boa qualidade visual, de preferência horizontal, sem marca d'água, sem texto dominante, sem parecer print de site. Se NENHUMA candidata cumprir os critérios, devolva cover.index = -1 — capa nenhuma é melhor que capa errada.
2. CORPO: escolha até ${inlineCount} OUTRAS imagens (índices diferentes da capa e entre si) que ilustrem bem aspectos do tema, para inserir entre os parágrafos. Só inclua as realmente úteis; lista vazia é aceitável.
3. Para CADA imagem escolhida, escreva um alt descritivo e específico (o que aparece na imagem, ligado ao tema).

Responda exclusivamente com um objeto JSON válido, sem markdown:
{ "cover": { "index": número ou -1, "alt": "..." }, "inline": [ { "index": número, "alt": "..." } ], "reason": "1 frase" }`;
  }
  return `You are the photo editor for a blog article about "${input.topic}".

The candidate images are attached in this order (index: title):
${list}

TASKS:
1. COVER: pick the BEST cover image. Strict criteria: shows the article's actual subject (not something only loosely related, like a component or accessory when the topic is the product), good visual quality, preferably landscape, no watermark, no dominant text, not a website screenshot. If NO candidate meets the bar, return cover.index = -1 — no cover beats a wrong cover.
2. BODY: pick up to ${inlineCount} OTHER images (indexes different from the cover and from each other) that illustrate aspects of the topic well, to place between paragraphs. Only include genuinely helpful ones; an empty list is fine.
3. For EACH chosen image, write descriptive, specific alt text (what it shows, tied to the topic).

Respond exclusively with a valid JSON object, no markdown:
{ "cover": { "index": number or -1, "alt": "..." }, "inline": [ { "index": number, "alt": "..." } ], "reason": "one sentence" }`;
}

interface IllustratePick {
  index?: unknown;
  alt?: unknown;
}

interface IllustrateParsed {
  cover?: IllustratePick;
  inline?: IllustratePick[];
  /** Tolerância ao formato antigo/achatado (provedores json_object). */
  images?: IllustratePick[];
  index?: unknown;
  alt?: unknown;
}

export async function illustrate(input: IllustrateInput, deps: IllustrateDeps): Promise<IllustrateResult> {
  const log = deps.log ?? (() => {});
  const llmCalls: LlmCallRecord[] = [];
  const base: IllustrateResult = { status: 'ok', cover: null, inline: [], candidatesCount: 0, llmCalls };
  const inlineCount = Math.max(input.inlineCount ?? 0, 0);

  const query = buildQuery(input);
  log(`ilustração [busca de imagem]: ${query}`);
  // pool suficiente para capa + inline com sobra de escolha
  const maxCandidates = Math.max(input.maxCandidates ?? 5, inlineCount + 3);
  // pool maior (grátis) → pré-rank determinístico → só as melhores vão à visão
  const pool = await deps.images.search(query, { limit: Math.max(maxCandidates * 3, 12) });
  const candidates = rankCandidates(pool, input, maxCandidates);
  base.candidatesCount = candidates.length;
  if (candidates.length === 0) return { ...base, status: 'no_candidates' };

  try {
    await deps.checkBudget?.();
  } catch (err) {
    if (err instanceof BudgetExceededError) return { ...base, status: 'budget_exceeded' };
    throw err;
  }

  let parsed: IllustrateParsed | null;
  try {
    const res = await deps.llmVision.complete({
      prompt: buildPrompt(input, candidates, inlineCount),
      images: candidates.map((c) => c.thumbnail),
      schema: buildResponseSchema(),
      schemaName: 'autopilot_illustrate',
      maxTokens: input.imageMaxTokens ?? 1_000,
      temperature: 0,
    });
    llmCalls.push({
      purpose: 'illustrate',
      provider: res.provider,
      model: res.model,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      costUsd: res.costUsd,
      durationMs: res.durationMs,
      status: res.truncated ? 'truncated' : 'ok',
    });
    parsed = extractJson(res.text) as IllustrateParsed | null;
  } catch (err) {
    if (err instanceof BudgetExceededError) return { ...base, status: 'budget_exceeded' };
    if (err instanceof LlmError) {
      llmCalls.push({
        purpose: 'illustrate',
        provider: deps.llmVision.provider,
        model: deps.llmVision.model,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: null,
        durationMs: 0,
        status: 'error',
      });
      return { ...base, status: 'llm_failed' };
    }
    throw err;
  }

  const coverIndex = Number(parsed?.cover?.index ?? parsed?.index);
  const validCover = Number.isInteger(coverIndex) && coverIndex >= 0 && coverIndex < candidates.length;
  const cover: ChosenImage | null = validCover
    ? {
        ...candidates[coverIndex]!,
        alt: String(parsed?.cover?.alt ?? parsed?.alt ?? '').trim() || input.topic,
      }
    : null;

  const inlineRaw =
    parsed && Array.isArray(parsed.inline) ? parsed.inline : parsed && Array.isArray(parsed.images) ? parsed.images : [];
  const used = new Set<number>(validCover ? [coverIndex] : []);
  const inline: ChosenImage[] = [];
  for (const item of inlineRaw) {
    if (inline.length >= inlineCount) break;
    const idx = Number(item?.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= candidates.length || used.has(idx)) continue;
    used.add(idx);
    inline.push({ ...candidates[idx]!, alt: String(item?.alt ?? '').trim() || input.topic });
  }

  if (!cover && inline.length === 0) {
    log('ilustração: nenhuma imagem relevante — post sem imagem');
    return { ...base, status: 'none_relevant' };
  }
  log(
    `ilustração: capa ${cover ? `${coverIndex} (${cover.license})` : 'nenhuma'}, ${inline.length} imagem(ns) no corpo`,
  );
  return { ...base, status: 'ok', cover, inline };
}
