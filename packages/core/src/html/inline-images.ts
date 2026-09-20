import { stripDiacritics } from '../i18n/slug';

/**
 * Injeção determinística de imagens no corpo do artigo: recebe o HTML final e
 * as imagens escolhidas pela visão (já hospedadas no WP) e insere blocos
 * Gutenberg de imagem distribuídos uniformemente entre os parágrafos. Nada de
 * LLM aqui — posição é aritmética, o que garante espaçamento consistente.
 */

export interface InlineImage {
  /** URL pública da imagem (após upload na mídia do WP). */
  url: string;
  alt: string;
  /** Legenda/atribuição (opcional — vazio não gera figcaption). */
  caption?: string;
  /**
   * ID do anexo no WordPress. É a identidade da imagem no HTML (`wp-image-ID`,
   * o mesmo que o Gutenberg grava): sem ele não há como saber, depois de
   * publicado, QUAL imagem trocar quando o usuário pede outra.
   */
  mediaId?: number;
}

const PARAGRAPH_END = /<!-- \/wp:paragraph -->/g;
const PLAIN_P_END = /<\/p>/g;
/** Regiões de bloco gerenciado (widget) — nunca inserir imagem dentro delas. */
export const MANAGED_RANGE = /<!-- ([A-Za-z0-9_-]+):START -->[\s\S]*?<!-- \1:END -->/g;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Quantas imagens inline cabem no texto, proporcional ao tamanho do conteúdo
 * visível (~1 imagem a cada 2.000 caracteres de texto), entre 1 e `max`.
 */
export function suggestedInlineCount(html: string, max: number): number {
  if (max <= 0 || !html) return 0;
  const textLen = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;
  if (textLen < 600) return 0; // texto curto demais para imagem no meio
  return Math.min(max, Math.max(1, Math.floor(textLen / 2000)));
}

export function gutenbergImageBlock(img: InlineImage): string {
  const caption = img.caption?.trim()
    ? `<figcaption class="wp-element-caption">${escapeHtml(img.caption.trim())}</figcaption>`
    : '';
  const attrs = img.mediaId
    ? `{"id":${img.mediaId},"sizeSlug":"large","linkDestination":"none"}`
    : `{"sizeSlug":"large","linkDestination":"none"}`;
  const cls = img.mediaId ? ` class="wp-image-${img.mediaId}"` : '';
  return (
    `\n<!-- wp:image ${attrs} -->\n` +
    `<figure class="wp-block-image size-large"><img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.alt)}"${cls}/>${caption}</figure>\n` +
    `<!-- /wp:image -->\n`
  );
}

function matchEnds(html: string, re: RegExp): number[] {
  const out: number[] = [];
  for (const m of html.matchAll(re)) out.push(m.index! + m[0]!.length);
  return out;
}

export interface InsertionPoint {
  /** Offset no HTML logo depois do parágrafo em que a imagem entra. */
  pos: number;
  /** Índice (base 0) do parágrafo, entre os parágrafos detectados. */
  paragraphIndex: number;
  /** Texto do parágrafo logo antes da imagem: o que a imagem deve ilustrar. */
  paragraphText: string;
  /** Título (h2..h4) mais próximo acima do ponto, quando houver. */
  heading: string | null;
}

const stripTags = (h: string) =>
  h.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

export interface PlanOptions {
  /**
   * Títulos de seção onde o editor disse que uma imagem ajudaria. Esses pontos
   * têm prioridade; o que sobrar do total é distribuído uniformemente. Sem isto,
   * a dica "uma imagem ajuda em Segurança" se perdia sempre que a aritmética
   * não caía naquela seção.
   */
  preferHeadings?: string[];
}

const normTitle = (t: string) => stripDiacritics(t.toLowerCase()).replace(/\s+/g, ' ').trim();

/** Onde começa o parágrafo que termina em `end`: o último `<p` depois de `floor`. */
function paragraphStart(html: string, floor: number, end: number): number {
  let i = html.lastIndexOf('<p', end - 1);
  while (i > floor && !/[\s>]/.test(html[i + 2] ?? '')) i = html.lastIndexOf('<p', i - 1); // pula <pre>, <path>...
  return i > floor ? i : floor;
}

/** Offsets logo depois de cada parágrafo, fora dos blocos gerenciados. */
export function paragraphEnds(html: string): number[] {
  if (!html) return [];
  const managed: Array<[number, number]> = [];
  for (const m of html.matchAll(MANAGED_RANGE)) managed.push([m.index!, m.index! + m[0]!.length]);
  let points = matchEnds(html, PARAGRAPH_END);
  if (points.length === 0) points = matchEnds(html, PLAIN_P_END);
  return points.filter((p) => !managed.some(([s, e]) => p > s && p < e));
}

/**
 * ONDE as imagens entram, e o que existe em volta de cada ponto. O planejamento
 * de imagens descreve cada slot a partir deste plano, e o slot guarda o
 * `paragraphIndex`: é ele que a injeção usa, sem recalcular nada.
 */
export function planInlineInsertions(html: string, count: number, opts: PlanOptions = {}): InsertionPoint[] {
  if (!html || count <= 0) return [];

  const points = paragraphEnds(html);
  if (points.length === 0) return [];

  const n = points.length;
  const k = Math.min(count, n);
  const headings = [...html.matchAll(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/gi)].map((m) => ({
    pos: m.index!,
    text: stripTags(m[1]!),
  }));

  const chosen = new Set<number>();

  // 1. Seções indicadas pelo editor: o primeiro parágrafo depois do título.
  for (const wanted of (opts.preferHeadings ?? []).map(normTitle).filter(Boolean)) {
    if (chosen.size >= k) break;
    const heading = headings.find((h) => normTitle(h.text) === wanted);
    if (!heading) continue;
    const target = points.findIndex((p) => p > heading.pos);
    if (target >= 0) chosen.add(target);
  }

  // 2. O que sobrou do total: distribuição uniforme, pulando o que já foi escolhido.
  const remaining = k - chosen.size;
  for (let i = 0; i < remaining; i++) {
    let target = Math.round(((i + 1) * n) / (remaining + 1)) - 1;
    target = Math.max(0, Math.min(n - 1, target));
    while (target < n && chosen.has(target)) target++;
    if (target >= n) {
      target = Math.max(0, Math.min(n - 1, Math.round(((i + 1) * n) / (remaining + 1)) - 1));
      while (target >= 0 && chosen.has(target)) target--;
      if (target < 0) break;
    }
    chosen.add(target);
  }

  return [...chosen]
    .sort((a, b) => a - b)
    .map((target) => {
      const pos = points[target]!;
      const before = target > 0 ? points[target - 1]! : 0;
      const heading = [...headings].reverse().find((h) => h.pos < pos)?.text ?? null;
      return {
        pos,
        paragraphIndex: target,
        // SÓ este parágrafo. Cortar desde o fim do anterior levava junto o título
        // da seção, que fica no meio, e a descrição do slot saía "Título Título texto".
        paragraphText: stripTags(html.slice(paragraphStart(html, before, pos), pos)),
        heading: heading || null,
      };
    });
}

/**
 * Insere as imagens após parágrafos, dividindo o texto em segmentos iguais
 * (k imagens em k+1 segmentos — nunca antes do primeiro parágrafo). Pontos
 * dentro de blocos gerenciados são ignorados. Se o HTML não tiver parágrafos
 * detectáveis, devolve o HTML intacto (fail-safe).
 */
export function injectInlineImages(html: string, images: InlineImage[]): string {
  if (!html || images.length === 0) return html;
  const plan = planInlineInsertions(html, images.length);
  return injectAfterParagraphs(
    html,
    plan.map((point, idx) => ({ afterParagraph: point.paragraphIndex, image: images[idx]! })),
  );
}

/**
 * Insere cada imagem depois do parágrafo indicado.
 *
 * O slot guarda o índice do parágrafo onde a imagem foi planejada, então a
 * imagem do slot 2 continua caindo depois do parágrafo do slot 2 mesmo quando o
 * slot 1 falhou. Redistribuir uniformemente (como `injectInlineImages`) faria as
 * demais deslizarem para posições que não combinam com a descrição com que
 * foram escolhidas.
 */
export function injectAfterParagraphs(
  html: string,
  entries: Array<{ afterParagraph: number; image: InlineImage }>,
): string {
  if (!html || entries.length === 0) return html;
  const ends = paragraphEnds(html);
  const insertions = entries
    .filter((e) => Number.isInteger(e.afterParagraph) && ends[e.afterParagraph] !== undefined)
    .map((e) => ({ pos: ends[e.afterParagraph]!, block: gutenbergImageBlock(e.image) }))
    .sort((a, b) => b.pos - a.pos);
  let out = html;
  for (const ins of insertions) out = out.slice(0, ins.pos) + ins.block + out.slice(ins.pos);
  return out;
}
