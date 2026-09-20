import { extractJson } from '../llm/parse';
import { LlmError } from '../llm/client';
import { stripDiacritics } from '../i18n/slug';
import type { JsonSchema, LlmProvider } from '../llm/types';
import { BudgetExceededError, type LlmCallRecord } from '../pipeline/types';
import type { ImageCandidate, ImageSearchClient } from './openverse';
import { ImageGenerationError, type ImageGenClient } from './generate';

/**
 * Ilustração de artigo (Fase 3): busca imagens (web + acervo aberto), mostra as
 * candidatas para um LLM com visão escolher a capa e as imagens do corpo do
 * texto (ou nenhuma) e gera alt text de cada uma. Fail-safe: se nada for
 * relevante, o post sai sem imagem — nunca uma imagem errada.
 * Funciona em modelos com visão baratos (gpt-4.1-mini, claude-haiku).
 */

export interface ChosenImage extends ImageCandidate {
  alt: string;
  /** Presente só na capa gerada pelo GPT (fallback) — bytes já prontos, sem download por URL. */
  inlineData?: { data: Uint8Array; mimeType: string };
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
  /**
   * Último recurso: gera a capa com IA quando nenhuma candidata passa na
   * revisão de qualidade. Opcional — sem isto, o comportamento é o de sempre
   * (post sem capa em vez de capa errada).
   */
  imageGen?: ImageGenClient;
  checkBudget?: () => Promise<void> | void;
  log?: (msg: string) => void;
}

export interface IllustrateResult {
  status: 'ok' | 'no_candidates' | 'none_relevant' | 'llm_failed' | 'budget_exceeded';
  /** Imagem destacada (capa) — null quando nenhuma candidata serviu nem a geração de IA. */
  cover: ChosenImage | null;
  /** Imagens escolhidas para o corpo do texto (podem existir mesmo sem capa). */
  inline: ChosenImage[];
  candidatesCount: number;
  /** true quando a capa não veio de uma candidata real — foi gerada com IA como último recurso. */
  coverGenerated: boolean;
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
  const coverPick = {
    type: 'object',
    properties: {
      ...pick.properties,
      qualityOk: {
        type: 'boolean',
        description:
          'true só se a imagem tiver boa resolução (nítida, não pixelada/esticada), NÃO tiver marca d\'água ou logo de outro site, e for uma imagem limpa (sem faixas de UI, sem print de tela). false em qualquer outro caso — mesmo que a imagem seja a mais relevante do lote.',
      },
    },
    required: ['index', 'alt', 'qualityOk'],
    additionalProperties: false,
  };
  return {
    type: 'object',
    properties: {
      cover: {
        ...coverPick,
        description:
          'Imagem de capa do artigo. index = -1 se NENHUMA candidata serve como capa (tema errado OU falha de qualidade).',
      },
      inline: {
        type: 'array',
        items: pick,
        description:
          'Imagens para o corpo do texto (índices diferentes da capa). Você decide QUANTAS incluir, de 0 até o limite informado — só as que realmente ajudam o leitor, com boa qualidade visual (sem marca d\'água, sem logo de outro site, sem parecer print de tela). Lista vazia é aceitável e preferível a imagem fraca.',
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
1. CAPA: escolha a MELHOR imagem de capa. Critérios rígidos, TODOS obrigatórios: (a) mostra o assunto do artigo em si, não algo apenas vagamente relacionado; (b) boa resolução — nítida, não pixelada, não esticada/borrada; (c) SEM marca d'água nem logo de outro site/marca estampado na imagem; (d) imagem limpa — sem parecer print de tela, sem faixas de UI, sem texto dominante sobreposto. Se a melhor imagem disponível falhar em QUALQUER um desses critérios, marque qualityOk=false. Se NENHUMA candidata cumprir os critérios (ou não houver imagem com o tema certo), devolva cover.index = -1 — capa nenhuma é melhor que capa errada ou de baixa qualidade.
2. CORPO: você decide QUANTAS imagens usar no corpo do texto, de 0 até ${inlineCount} (índices diferentes da capa e entre si). Escolha só as que realmente ajudam o leitor a entender o tema E têm boa qualidade visual (mesmos critérios da capa, sem marca d'água/logo de outro site). Não preencha até o limite só por preencher — lista vazia é aceitável e preferível a imagem fraca.
3. Para CADA imagem escolhida, escreva um alt descritivo e específico (o que aparece na imagem, ligado ao tema).

Responda exclusivamente com um objeto JSON válido, sem markdown:
{ "cover": { "index": número ou -1, "alt": "...", "qualityOk": true ou false }, "inline": [ { "index": número, "alt": "..." } ], "reason": "1 frase" }`;
  }
  return `You are the photo editor for a blog article about "${input.topic}".

The candidate images are attached in this order (index: title):
${list}

TASKS:
1. COVER: pick the BEST cover image. Strict criteria, ALL mandatory: (a) shows the article's actual subject, not something only loosely related; (b) good resolution — sharp, not pixelated, not stretched/blurry; (c) NO watermark or another site's/brand's logo stamped on it; (d) clean image — not a screenshot, no UI chrome, no dominant overlaid text. If the best available image fails ANY of these, set qualityOk=false. If NO candidate meets the bar (wrong subject or none has an image with the right topic), return cover.index = -1 — no cover beats a wrong or low-quality one.
2. BODY: you decide HOW MANY images to use in the body, from 0 up to ${inlineCount} (indexes different from the cover and from each other). Only pick ones that genuinely help the reader AND have good visual quality (same bar as the cover, no watermark/other site's logo). Don't fill up to the limit just to fill it — an empty list is fine and preferable to a weak image.
3. For EACH chosen image, write descriptive, specific alt text (what it shows, tied to the topic).

Respond exclusively with a valid JSON object, no markdown:
{ "cover": { "index": number or -1, "alt": "...", "qualityOk": true or false }, "inline": [ { "index": number, "alt": "..." } ], "reason": "one sentence" }`;
}

interface IllustratePick {
  index?: unknown;
  alt?: unknown;
  qualityOk?: unknown;
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
  const base: IllustrateResult = {
    status: 'ok',
    cover: null,
    inline: [],
    candidatesCount: 0,
    coverGenerated: false,
    llmCalls,
  };
  const inlineCount = Math.max(input.inlineCount ?? 0, 0);

  const query = buildQuery(input);
  log(`ilustração [busca de imagem]: ${query}`);
  // pool suficiente para capa + inline com sobra de escolha
  const maxCandidates = Math.max(input.maxCandidates ?? 5, inlineCount + 3);
  // pool maior (grátis) → pré-rank determinístico → só as melhores vão à visão
  const pool = await deps.images.search(query, { limit: Math.max(maxCandidates * 3, 12) });
  const candidates = rankCandidates(pool, input, maxCandidates);
  base.candidatesCount = candidates.length;
  if (candidates.length === 0) {
    const generated = await generateFallbackCover(input, deps, log);
    if (generated) return { ...base, status: 'ok', cover: generated, coverGenerated: true };
    return { ...base, status: 'no_candidates' };
  }

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
  const inRange = Number.isInteger(coverIndex) && coverIndex >= 0 && coverIndex < candidates.length;
  // Tolera o formato antigo/achatado (sem qualityOk): trata como aprovado.
  const qualityOk = parsed?.cover?.qualityOk !== false;
  const validCover = inRange && qualityOk;
  if (inRange && !qualityOk) log('ilustração: capa candidata reprovada na revisão de qualidade');
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

  if (!cover) {
    const generated = await generateFallbackCover(input, deps, log);
    if (generated) {
      log(`ilustração: nenhuma candidata aprovada — capa gerada com IA, ${inline.length} imagem(ns) no corpo`);
      return { ...base, status: 'ok', cover: generated, coverGenerated: true, inline };
    }
    if (inline.length === 0) {
      log('ilustração: nenhuma imagem relevante — post sem imagem');
      return { ...base, status: 'none_relevant' };
    }
  }
  log(
    `ilustração: capa ${cover ? `${coverIndex} (${cover.license})` : 'nenhuma'}, ${inline.length} imagem(ns) no corpo`,
  );
  return { ...base, status: 'ok', cover, inline };
}

/**
 * Último recurso: gera a capa com IA (OpenAI) quando nada da web/acervo
 * serviu. Falha na geração nunca derruba o pipeline — cai no comportamento
 * de sempre (post sem capa).
 */
async function generateFallbackCover(
  input: IllustrateInput,
  deps: IllustrateDeps,
  log: (msg: string) => void,
): Promise<ChosenImage | null> {
  if (!deps.imageGen) return null;
  const prompt = `Editorial illustration for a blog article about "${input.topic}"${
    input.keywords.length ? ` (${input.keywords.slice(0, 3).join(', ')})` : ''
  }. Photorealistic, clean composition, no text, no watermark, no logos.`;
  log('ilustração: gerando capa com IA (nenhuma candidata aprovada)');
  let generated;
  try {
    generated = await deps.imageGen.generate(prompt);
  } catch (err) {
    const reason = err instanceof ImageGenerationError || err instanceof Error ? err.message : String(err);
    log(`ilustração: geração de capa com IA falhou: ${reason}`);
    return null;
  }
  if (!generated) {
    log('ilustração: geração de capa com IA falhou');
    return null;
  }
  return {
    url: 'generated:openai',
    thumbnail: 'generated:openai',
    title: input.topic,
    license: 'generated',
    attribution: '',
    sourcePage: '',
    provider: 'openai-generated',
    alt: input.topic,
    inlineData: generated,
  };
}
