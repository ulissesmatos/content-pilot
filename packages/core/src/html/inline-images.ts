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

function gutenbergImageBlock(img: InlineImage): string {
  const caption = img.caption?.trim()
    ? `<figcaption class="wp-element-caption">${escapeHtml(img.caption.trim())}</figcaption>`
    : '';
  return (
    `\n<!-- wp:image {"sizeSlug":"large","linkDestination":"none"} -->\n` +
    `<figure class="wp-block-image size-large"><img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.alt)}"/>${caption}</figure>\n` +
    `<!-- /wp:image -->\n`
  );
}

function matchEnds(html: string, re: RegExp): number[] {
  const out: number[] = [];
  for (const m of html.matchAll(re)) out.push(m.index! + m[0]!.length);
  return out;
}

/**
 * Insere as imagens após parágrafos, dividindo o texto em segmentos iguais
 * (k imagens em k+1 segmentos — nunca antes do primeiro parágrafo). Pontos
 * dentro de blocos gerenciados são ignorados. Se o HTML não tiver parágrafos
 * detectáveis, devolve o HTML intacto (fail-safe).
 */
export function injectInlineImages(html: string, images: InlineImage[]): string {
  if (!html || images.length === 0) return html;

  const managed: Array<[number, number]> = [];
  for (const m of html.matchAll(MANAGED_RANGE)) managed.push([m.index!, m.index! + m[0]!.length]);

  let points = matchEnds(html, PARAGRAPH_END);
  if (points.length === 0) points = matchEnds(html, PLAIN_P_END);
  points = points.filter((p) => !managed.some(([s, e]) => p > s && p < e));
  if (points.length === 0) return html;

  const n = points.length;
  const k = Math.min(images.length, n);
  const usedPoints = new Set<number>();
  const insertions: Array<{ pos: number; block: string }> = [];
  for (let i = 0; i < k; i++) {
    let target = Math.round(((i + 1) * n) / (k + 1)) - 1;
    target = Math.max(0, Math.min(n - 1, target));
    while (target < n && usedPoints.has(points[target]!)) target++;
    if (target >= n) break;
    usedPoints.add(points[target]!);
    insertions.push({ pos: points[target]!, block: gutenbergImageBlock(images[i]!) });
  }

  // insere de trás para frente para não deslocar os offsets anteriores
  insertions.sort((a, b) => b.pos - a.pos);
  let out = html;
  for (const ins of insertions) out = out.slice(0, ins.pos) + ins.block + out.slice(ins.pos);
  return out;
}
