import { extractJson } from '../llm/parse';
import { LlmError } from '../llm/client';
import { stripDiacritics } from '../i18n/slug';
import type { JsonSchema, LlmProvider } from '../llm/types';
import { BudgetExceededError, type LlmCallRecord } from '../pipeline/types';
import type { ImageCandidate, ImageSearchClient } from './openverse';
import { ImageGenerationError, type ImageGenClient, type ImageSize } from './generate';
import { planImageSlots, type ImageSlot } from './slots';

/**
 * Ilustração de artigo, por slot.
 *
 * Cada imagem (capa e corpo) é um slot com sua própria busca, sua própria
 * chamada de visão e, quando nada serve, um fallback de geração por IA no
 * tamanho do slot. Fail-safe continua valendo: melhor sem imagem do que com uma
 * errada. A capa é a exceção que o produto exige: ela tem prioridade em tudo e,
 * se faltar no fim, o chamador é avisado (`coverMissing`) para não publicar.
 */

/** Imagem já baixada, medida e reduzida para a visão. Quem prepara é o worker (sharp). */
export interface PreparedImage {
  candidate: ImageCandidate;
  /** Miniatura para a visão. Data URL base64: o provedor de IA não baixa nada. */
  thumbnail: string;
  original: { data: Uint8Array; mimeType: string; width: number; height: number };
}

export interface ChosenImage {
  slot: ImageSlot;
  origin: 'search' | 'source' | 'generated';
  alt: string;
  /** Crédito para a legenda; vazio quando a licença é desconhecida ou a imagem é gerada. */
  caption: string;
  license: string;
  sourcePage: string;
  original: { data: Uint8Array; mimeType: string; width: number; height: number };
}

export interface IllustrateInput {
  topic: string;
  keywords: string[];
  language: string;
  /** HTML final do artigo: dele saem as posições e o contexto de cada slot. */
  html: string;
  inlineCount: number;
  coverSize: ImageSize;
  inlineSize: ImageSize;
  /** Quantas candidatas mostrar à visão por slot (default 6). */
  maxCandidates?: number;
  imageMaxTokens?: number;
}

export interface IllustrateDeps {
  /** Busca (web + acervo aberto). Chamada uma vez por slot, com a consulta do slot. */
  images: ImageSearchClient;
  /** Imagens de destaque das fontes do artigo (og:image). */
  sourceImages?: () => Promise<ImageCandidate[]>;
  /** Baixa, valida e reduz. `null` descarta o candidato (falhou, pequeno demais, banner...). */
  prepare: (candidate: ImageCandidate, slot: ImageSlot) => Promise<PreparedImage | null>;
  llmVision: LlmProvider;
  /** Fallback: gera a imagem quando nenhuma candidata serve. */
  imageGen?: ImageGenClient;
  checkBudget?: () => Promise<void> | void;
  log?: (msg: string) => void;
}

export interface IllustrateResult {
  status: 'ok' | 'no_images' | 'budget_exceeded';
  cover: ChosenImage | null;
  inline: ChosenImage[];
  /** Nenhum meio produziu capa. O chamador NÃO deve publicar o post. */
  coverMissing: boolean;
  /** Quantos slots do corpo foram planejados (para `injectPlannedImages`). */
  plannedInline: number;
  llmCalls: LlmCallRecord[];
  /** Uma linha por slot: de onde veio a imagem, ou por que não veio. */
  notes: string[];
}

const normalizeText = (s: string) => stripDiacritics(s.toLowerCase()).replace(/[^a-z0-9\s]/g, ' ');

/**
 * Pré-rank determinístico (economia de IA): pontua candidatas pela sobreposição
 * de tokens entre título da imagem e tópico/keywords do artigo. A decisão final
 * continua sendo da visão (fail-safe).
 */
export function rankCandidates(
  candidates: ImageCandidate[],
  input: { topic: string; keywords: string[] },
  keep: number,
): ImageCandidate[] {
  if (candidates.length <= keep) return candidates;
  const refTokens = new Set(
    normalizeText([input.topic, ...input.keywords].join(' '))
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
  const scored = candidates.map((c, i) => {
    let overlap = 0;
    for (const t of normalizeText(c.title).split(/\s+/).filter((t) => t.length > 2)) if (refTokens.has(t)) overlap++;
    return { c, i, score: overlap };
  });
  return scored
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, keep)
    .map((s) => s.c);
}

interface VisionPick {
  index?: unknown;
  alt?: unknown;
  qualityOk?: unknown;
  fits?: unknown;
  reason?: unknown;
}

function buildSchema(): JsonSchema {
  return {
    type: 'object',
    properties: {
      index: { type: 'integer', description: 'Índice (base 0) da imagem escolhida. -1 se NENHUMA serve.' },
      alt: { type: 'string', description: 'Texto alternativo descritivo e específico.' },
      qualityOk: {
        type: 'boolean',
        description:
          'true só se a imagem é nítida (não pixelada/esticada), sem marca d\'água, sem logo de outro site, e limpa (sem faixas de UI, sem print de tela).',
      },
      fits: { type: 'boolean', description: 'true só se a imagem mostra o assunto deste slot, e não algo vagamente relacionado.' },
      reason: { type: 'string' },
    },
    required: ['index', 'alt', 'qualityOk', 'fits', 'reason'],
    additionalProperties: false,
  };
}

function buildVisionPrompt(slot: ImageSlot, topic: string, prepared: PreparedImage[], language: string): string {
  const pt = language.toLowerCase().startsWith('pt');
  const list = prepared.map((p, i) => `${i}: ${p.candidate.title || '(sem título)'}`).join('\n');
  const role = slot.role === 'cover' ? (pt ? 'CAPA' : 'COVER') : pt ? 'IMAGEM DO CORPO' : 'BODY IMAGE';

  if (pt) {
    return `Você é o editor de imagens de um blog. Escolha a imagem para: ${role}.

CONTEXTO: ${slot.description}

As candidatas estão anexadas nesta ordem (índice: título):
${list}

Critérios rígidos, TODOS obrigatórios:
(a) mostra o assunto deste slot, não algo só vagamente relacionado;
(b) boa resolução, nítida, sem pixelização nem estiramento;
(c) SEM marca d'água nem logo de outro site estampado;
(d) imagem limpa: sem parecer print de tela, sem faixas de interface, sem texto dominante sobreposto${slot.role === 'cover' ? ';\n(e) funciona como miniatura: assunto legível mesmo pequena.' : '.'}

Se nenhuma cumprir TODOS os critérios, devolva index = -1. Imagem nenhuma é melhor que uma errada; o sistema gera uma sob medida.
Escreva um alt descritivo e específico (o que aparece, ligado ao tema).

Responda exclusivamente com JSON: { "index": número ou -1, "alt": "...", "qualityOk": true|false, "fits": true|false, "reason": "1 frase" }`;
  }
  return `You are a blog photo editor. Pick the image for: ${role}.

CONTEXT: ${slot.description}

Candidates are attached in this order (index: title):
${list}

Strict criteria, ALL mandatory:
(a) shows this slot's subject, not something loosely related;
(b) good resolution, sharp, not pixelated or stretched;
(c) NO watermark or another site's logo stamped on it;
(d) clean image: not a screenshot, no UI chrome, no dominant overlaid text${slot.role === 'cover' ? ';\n(e) works as a thumbnail: subject readable when small.' : '.'}

If none meets ALL criteria, return index = -1. No image beats a wrong one; the system generates a fitting one.
Write descriptive, specific alt text.

Respond exclusively with JSON: { "index": number or -1, "alt": "...", "qualityOk": true|false, "fits": true|false, "reason": "one sentence" }`;
}

/** Prompt de geração: o que o slot pede, no estilo de imagem editorial. */
export function buildGenerationPrompt(slot: ImageSlot, topic: string): string {
  const scene = slot.heading ? `${topic}: ${slot.heading}` : topic;
  const role = slot.role === 'cover' ? 'cover image' : 'in-article illustration';
  const ratio = slot.size.width >= slot.size.height ? 'wide landscape composition' : 'portrait composition';
  return [
    `Editorial ${role} for a blog article about "${scene}".`,
    slot.role === 'inline' ? `It illustrates this passage: ${slot.description.split(': ').slice(1).join(': ').slice(0, 300)}` : '',
    `High-quality, ${ratio}, clean, subject clearly visible, natural lighting.`,
    slot.allowText
      ? 'Text is allowed only if essential to the subject.'
      : 'No text, no captions, no watermarks, no logos, no UI elements.',
  ]
    .filter(Boolean)
    .join(' ');
}

export async function illustrateArticle(input: IllustrateInput, deps: IllustrateDeps): Promise<IllustrateResult> {
  const log = deps.log ?? (() => {});
  const llmCalls: LlmCallRecord[] = [];
  const notes: string[] = [];
  const maxCandidates = Math.max(input.maxCandidates ?? 6, 3);
  const inlineCount = Math.max(input.inlineCount, 0);

  const slots = planImageSlots({
    topic: input.topic,
    keywords: input.keywords,
    html: input.html,
    inlineCount,
    coverSize: input.coverSize,
    inlineSize: input.inlineSize,
  });
  log(`ilustração: ${slots.length} imagem(ns) planejada(s) (1 capa + ${slots.length - 1} no corpo)`);

  // Fontes oficiais: buscadas uma vez, servem a todos os slots.
  let sourcePool: ImageCandidate[] = [];
  if (deps.sourceImages) {
    try {
      sourcePool = await deps.sourceImages();
      if (sourcePool.length > 0) log(`ilustração: ${sourcePool.length} imagem(ns) de destaque nas fontes do artigo`);
    } catch {
      sourcePool = [];
    }
  }

  const used = new Set<string>();
  const result: IllustrateResult = {
    status: 'ok',
    cover: null,
    inline: [],
    coverMissing: false,
    plannedInline: slots.filter((s) => s.role === 'inline').length,
    llmCalls,
    notes,
  };

  for (const slot of slots) {
    let chosen: ChosenImage | null = null;
    try {
      chosen = await fillSlot(slot, input, deps, { sourcePool, used, maxCandidates, llmCalls, notes, log });
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        result.status = 'budget_exceeded';
        notes.push(`${slot.id}: orçamento de tokens esgotado`);
        break;
      }
      throw err;
    }
    if (!chosen) continue;
    if (slot.role === 'cover') result.cover = chosen;
    else result.inline.push(chosen);
  }

  result.coverMissing = result.cover === null;
  if (result.coverMissing) {
    log('ilustração: NENHUMA capa disponível. O post não deve ser publicado sem capa.');
    if (result.inline.length === 0 && result.status === 'ok') result.status = 'no_images';
  }
  return result;
}

interface SlotCtx {
  sourcePool: ImageCandidate[];
  used: Set<string>;
  maxCandidates: number;
  llmCalls: LlmCallRecord[];
  notes: string[];
  log: (msg: string) => void;
}

async function fillSlot(
  slot: ImageSlot,
  input: IllustrateInput,
  deps: IllustrateDeps,
  ctx: SlotCtx,
): Promise<ChosenImage | null> {
  const { log, notes } = ctx;
  log(`ilustração [${slot.id}] busca: ${slot.query}`);

  let searched: ImageCandidate[] = [];
  try {
    searched = await deps.images.search(slot.query, { limit: Math.max(ctx.maxCandidates * 3, 12) });
  } catch {
    searched = [];
  }

  // Fontes oficiais primeiro (até 3), depois o resto pré-ranqueado. Sem repetir imagem entre slots.
  const fresh = (list: ImageCandidate[]) => list.filter((c) => !ctx.used.has(c.url));
  const official = fresh(ctx.sourcePool).slice(0, 3);
  const rest = rankCandidates(
    fresh(searched).filter((c) => !official.some((o) => o.url === c.url)),
    { topic: slot.description, keywords: input.keywords },
    ctx.maxCandidates * 2,
  );
  const pool = [...official, ...rest];

  // Baixa e mede ANTES de mostrar à visão: candidata que o servidor nem entrega
  // (anti-hotlink, 403, pequena demais) sai aqui e não derruba a chamada inteira.
  const prepared = (await Promise.all(pool.map((c) => deps.prepare(c, slot).catch(() => null))))
    .filter((p): p is PreparedImage => p !== null)
    .slice(0, ctx.maxCandidates);
  log(`ilustração [${slot.id}]: ${prepared.length} de ${pool.length} candidata(s) utilizáveis`);

  if (prepared.length > 0) {
    await deps.checkBudget?.();
    const pick = await askVision(slot, input, deps, prepared, ctx);
    if (pick) {
      const p = prepared[pick.index]!;
      ctx.used.add(p.candidate.url);
      const origin = p.candidate.provider === 'source-page' ? 'source' : 'search';
      notes.push(`${slot.id}: ${origin === 'source' ? 'imagem da fonte' : 'imagem da busca'} (${p.candidate.provider})`);
      log(`ilustração [${slot.id}]: escolhida da ${origin === 'source' ? 'fonte' : 'busca'} (${p.candidate.provider})`);
      return {
        slot,
        origin,
        alt: pick.alt || input.topic,
        caption: p.candidate.attribution,
        license: p.candidate.license,
        sourcePage: p.candidate.sourcePage,
        original: p.original,
      };
    }
  } else {
    notes.push(`${slot.id}: nenhuma candidata utilizável`);
  }

  return generateForSlot(slot, input, deps, ctx);
}

async function askVision(
  slot: ImageSlot,
  input: IllustrateInput,
  deps: IllustrateDeps,
  prepared: PreparedImage[],
  ctx: SlotCtx,
): Promise<{ index: number; alt: string } | null> {
  const attempt = async (subset: PreparedImage[]): Promise<{ index: number; alt: string } | 'rejected' | 'failed'> => {
    try {
      const res = await deps.llmVision.complete({
        prompt: buildVisionPrompt(slot, input.topic, subset, input.language),
        images: subset.map((p) => p.thumbnail),
        schema: buildSchema(),
        schemaName: 'autopilot_illustrate',
        maxTokens: input.imageMaxTokens ?? 3_000,
        temperature: 0,
      });
      ctx.llmCalls.push({
        purpose: 'illustrate',
        provider: res.provider,
        model: res.model,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        costUsd: res.costUsd,
        durationMs: res.durationMs,
        status: res.truncated ? 'truncated' : 'ok',
      });
      const parsed = extractJson(res.text) as VisionPick | null;
      const index = Number(parsed?.index);
      const inRange = Number.isInteger(index) && index >= 0 && index < subset.length;
      const good = inRange && parsed?.qualityOk !== false && parsed?.fits !== false;
      if (!good) {
        const why = String(parsed?.reason ?? '').trim();
        ctx.log(`ilustração [${slot.id}]: nenhuma candidata aprovada pela visão${why ? ` (${why})` : ''}`);
        return 'rejected';
      }
      // o índice é do subconjunto mostrado; devolvemos relativo ao conjunto completo
      return { index: prepared.indexOf(subset[index]!), alt: String(parsed?.alt ?? '').trim() };
    } catch (err) {
      if (err instanceof BudgetExceededError) throw err;
      if (err instanceof LlmError) {
        ctx.llmCalls.push({
          purpose: 'illustrate',
          provider: deps.llmVision.provider,
          model: deps.llmVision.model,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: null,
          durationMs: 0,
          status: 'error',
        });
        // O motivo vai para o log. Antes só aparecia "llm_failed", e não dava
        // para saber se era chave, modelo, limite ou imagem.
        ctx.log(`ilustração [${slot.id}]: visão falhou: ${err.message}`);
        return 'failed';
      }
      throw err;
    }
  };

  const first = await attempt(prepared);
  if (first !== 'failed' && first !== 'rejected') return first;
  if (first === 'rejected') return null;

  // Falha de chamada (não de julgamento): uma nova tentativa com menos imagens.
  // Menos anexos é menos chance de o provedor recusar a requisição por tamanho.
  if (prepared.length > 3) {
    ctx.log(`ilustração [${slot.id}]: nova tentativa com ${3} imagens`);
    const second = await attempt(prepared.slice(0, 3));
    if (second !== 'failed' && second !== 'rejected') return second;
  }
  return null;
}

async function generateForSlot(
  slot: ImageSlot,
  input: IllustrateInput,
  deps: IllustrateDeps,
  ctx: SlotCtx,
): Promise<ChosenImage | null> {
  const { log, notes } = ctx;
  if (!deps.imageGen) {
    notes.push(`${slot.id}: sem imagem (nenhuma serviu e não há gerador de imagem configurado)`);
    log(`ilustração [${slot.id}]: sem imagem, e nenhum gerador de imagem configurado`);
    return null;
  }

  log(`ilustração [${slot.id}]: gerando com IA (${slot.size.width}x${slot.size.height})`);
  try {
    const generated = await deps.imageGen.generate(buildGenerationPrompt(slot, input.topic), { size: slot.size });
    if (!generated) throw new ImageGenerationError('o gerador não devolveu imagem');
    notes.push(`${slot.id}: gerada por IA`);
    return {
      slot,
      origin: 'generated',
      alt: slot.heading ? `${slot.heading}` : input.topic,
      caption: '',
      license: 'generated',
      sourcePage: '',
      // largura/altura reais são lidas no processamento; aqui só o tamanho pedido
      original: { data: generated.data, mimeType: generated.mimeType, width: slot.size.width, height: slot.size.height },
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    notes.push(`${slot.id}: geração por IA falhou (${reason})`);
    log(`ilustração [${slot.id}]: geração por IA falhou: ${reason}`);
    return null;
  }
}
