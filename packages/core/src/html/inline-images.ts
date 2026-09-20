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
const MANAGED_RANGE = /<!-- ([A-Za-z0-9_-]+):START -->[\s\S]*?<!-- \1:END -->/g;

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

/**
 * ONDE as imagens entram, e o que existe em volta de cada ponto. Fonte única
 * de verdade: o planejamento de imagens (que descreve o que cada slot deve
 * mostrar) e a injeção usam este mesmo plano, então a descrição nunca aponta
 * para um parágrafo diferente do que recebe a imagem.
 */
export function planInlineInsertions(html: string, count: number): InsertionPoint[] {
  if (!html || count <= 0) return [];

  const managed: Array<[number, number]> = [];
  for (const m of html.matchAll(MANAGED_RANGE)) managed.push([m.index!, m.index! + m[0]!.length]);

  let points = matchEnds(html, PARAGRAPH_END);
  if (points.length === 0) points = matchEnds(html, PLAIN_P_END);
  points = points.filter((p) => !managed.some(([s, e]) => p > s && p < e));
  if (points.length === 0) return [];

  const n = points.length;
  const k = Math.min(count, n);
  const used = new Set<number>();
  const plan: InsertionPoint[] = [];
  const headings = [...html.matchAll(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/gi)].map((m) => ({
    pos: m.index!,
    text: stripTags(m[1]!),
  }));

  for (let i = 0; i < k; i++) {
    let target = Math.round(((i + 1) * n) / (k + 1)) - 1;
    target = Math.max(0, Math.min(n - 1, target));
    while (target < n && used.has(target)) target++;
    if (target >= n) break;
    used.add(target);

    const pos = points[target]!;
    const before = target > 0 ? points[target - 1]! : 0;
    const heading = [...headings].reverse().find((h) => h.pos < pos)?.text ?? null;
    plan.push({ pos, paragraphIndex: target, paragraphText: stripTags(html.slice(before, pos)), heading: heading || null });
  }
  return plan;
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
  if (plan.length === 0) return html;

  const insertions = plan.map((point, i) => ({ pos: point.pos, block: gutenbergImageBlock(images[i]!) }));

  // insere de trás para frente para não deslocar os offsets anteriores
  insertions.sort((a, b) => b.pos - a.pos);
  let out = html;
  for (const ins of insertions) out = out.slice(0, ins.pos) + ins.block + out.slice(ins.pos);
  return out;
}

/**
 * Insere cada imagem no ponto que foi PLANEJADO para o slot dela.
 *
 * `injectInlineImages` redistribui as imagens que sobraram uniformemente; isso
 * serve quando todas chegam, mas quando uma falha as demais deslizam para
 * posições que não combinam com a descrição com que foram escolhidas. Aqui o
 * slot 2 continua caindo depois do parágrafo do slot 2, falhe o slot 1 ou não.
 */
export function injectPlannedImages(
  html: string,
  plannedCount: number,
  entries: Array<{ slotIndex: number; image: InlineImage }>,
): string {
  if (!html || entries.length === 0) return html;
  const plan = planInlineInsertions(html, plannedCount);
  const insertions = entries
    .filter((e) => plan[e.slotIndex])
    .map((e) => ({ pos: plan[e.slotIndex]!.pos, block: gutenbergImageBlock(e.image) }))
    .sort((a, b) => b.pos - a.pos);
  let out = html;
  for (const ins of insertions) out = out.slice(0, ins.pos) + ins.block + out.slice(ins.pos);
  return out;
}
