import { parseTweet, parseYoutubeId } from '../embeds/parse';
import { gutenbergImageBlock, MANAGED_RANGE, type InlineImage } from './inline-images';

/**
 * O artigo do WordPress como uma lista de blocos que a tela de preview sabe
 * desenhar: texto, imagem (com a identidade `wp-image-ID` para poder trocá-la) e
 * embed. Lógica pura sobre o HTML Gutenberg, sem sanitização: quem exibe o texto
 * passa o trecho `html` por um sanitizador antes de renderizar.
 */

export type ArticleSegment =
  | { kind: 'html'; html: string }
  | {
      kind: 'image';
      /** `wp-image-ID` do Gutenberg; null em imagem colada sem anexo. */
      mediaId: number | null;
      url: string;
      alt: string;
      caption: string;
    }
  | { kind: 'embed'; provider: 'youtube' | 'tweet' | 'other'; url: string; id: string | null };

/** Bloco `core/image` e `core/embed` inteiros, com o JSON de atributos do comentário. */
const BLOCK = /<!-- wp:(image|embed)(?: (\{[\s\S]*?\}))? -->([\s\S]*?)<!-- \/wp:\1 -->/g;

function parseAttrs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const decodeEntities = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`, 'i').exec(tag);
  return m ? decodeEntities(m[1]!) : '';
};

/** ID do anexo de um bloco de imagem: o do atributo do bloco, senão a classe `wp-image-N`. */
export function imageBlockMediaId(attrs: Record<string, unknown>, body: string): number | null {
  if (typeof attrs.id === 'number' && attrs.id > 0) return attrs.id;
  const m = /class="[^"]*\bwp-image-(\d+)\b/.exec(body);
  return m ? Number(m[1]) : null;
}

function imageSegment(attrs: Record<string, unknown>, body: string): ArticleSegment | null {
  const img = /<img\b[^>]*>/i.exec(body)?.[0];
  if (!img) return null;
  const caption = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(body)?.[1] ?? '';
  return {
    kind: 'image',
    mediaId: imageBlockMediaId(attrs, body),
    url: attr(img, 'src'),
    alt: attr(img, 'alt'),
    caption: decodeEntities(caption.replace(/<[^>]+>/g, '').trim()),
  };
}

function embedSegment(attrs: Record<string, unknown>, body: string): ArticleSegment | null {
  // a URL fica no atributo do bloco; blocos antigos só a têm dentro do wrapper
  const fromBody = /<div class="wp-block-embed__wrapper">\s*([^\s<]+)\s*<\/div>/.exec(body)?.[1];
  const url = typeof attrs.url === 'string' && attrs.url ? attrs.url : (fromBody ?? '');
  if (!url) return null;
  const yt = parseYoutubeId(url);
  if (yt) return { kind: 'embed', provider: 'youtube', url, id: yt };
  const tw = parseTweet(url);
  if (tw) return { kind: 'embed', provider: 'tweet', url, id: tw.id };
  return { kind: 'embed', provider: 'other', url, id: null };
}

/** Quebra o HTML nos blocos de texto, imagem e embed, na ordem em que aparecem. */
export function splitArticle(html: string): ArticleSegment[] {
  const out: ArticleSegment[] = [];
  let last = 0;
  const pushHtml = (chunk: string) => {
    // um trecho só de espaço e comentários de bloco não é conteúdo
    if (chunk.replace(/<!--[\s\S]*?-->/g, '').trim()) out.push({ kind: 'html', html: chunk });
  };

  for (const m of html.matchAll(BLOCK)) {
    const attrs = parseAttrs(m[2]);
    const seg = m[1] === 'image' ? imageSegment(attrs, m[3]!) : embedSegment(attrs, m[3]!);
    pushHtml(html.slice(last, m.index));
    if (seg) out.push(seg);
    else pushHtml(m[0]); // bloco que não conseguimos ler continua no texto, como o WP o desenharia
    last = m.index! + m[0]!.length;
  }
  pushHtml(html.slice(last));
  return out;
}

/**
 * Troca no HTML a imagem de `mediaId` por outra, no mesmo lugar. O bloco inteiro é
 * reescrito (id, URL, alt, legenda) em vez de remendar os atributos: assim nenhum
 * `wp-image-ANTIGO` ou URL velha sobra para trás.
 */
export function replaceImageBlock(html: string, mediaId: number, next: InlineImage): { html: string; replaced: boolean } {
  let replaced = false;
  const out = html.replace(BLOCK, (whole, kind: string, rawAttrs: string | undefined, body: string) => {
    if (kind !== 'image' || replaced) return whole;
    if (imageBlockMediaId(parseAttrs(rawAttrs), body) !== mediaId) return whole;
    replaced = true;
    // gutenbergImageBlock já abre e fecha com quebra de linha; o original tinha as suas
    return gutenbergImageBlock(next).trim();
  });
  return { html: out, replaced };
}

/**
 * Ajusta só o SEO de uma imagem que já está no post (alt e legenda), mantendo a mesma URL e o mesmo
 * anexo. O bloco inteiro é reescrito para o `alt` e o `<figcaption>` nunca ficarem dessincronizados.
 */
export function updateImageBlockSeo(
  html: string,
  mediaId: number,
  seo: { alt: string; caption: string },
): { html: string; replaced: boolean; url: string | null } {
  let replaced = false;
  let url: string | null = null;
  const out = html.replace(BLOCK, (whole, kind: string, rawAttrs: string | undefined, body: string) => {
    if (kind !== 'image' || replaced) return whole;
    const attrs = parseAttrs(rawAttrs);
    if (imageBlockMediaId(attrs, body) !== mediaId) return whole;
    const seg = imageSegment(attrs, body);
    if (!seg || seg.kind !== 'image') return whole;
    replaced = true;
    url = seg.url;
    return gutenbergImageBlock({ url: seg.url, alt: seo.alt, caption: seo.caption, mediaId }).trim();
  });
  return { html: out, replaced, url };
}

// ---------- edição básica do texto ----------

/** Um trecho de texto do artigo que pode ser editado: parágrafo, título de seção ou item de lista. */
export interface EditableText {
  /** Posição entre os trechos editáveis, na ordem do HTML. É a identidade que a tela e o servidor usam. */
  index: number;
  tag: 'p' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'li';
  /** Onde começa a tag de abertura, e onde termina (logo após o `>`). */
  openStart: number;
  openEnd: number;
  /** O conteúdo de dentro (entre a abertura e o fechamento), como está no HTML. */
  inner: string;
  innerStart: number;
  innerEnd: number;
}

const TEXT_ELEMENT = /<(p|h[2-6]|li)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
/** Dentro destes blocos nada é texto do artigo: imagem, embed, HTML solto, código, tabela, shortcode. */
const NON_TEXT_BLOCK = /<!-- wp:(image|embed|html|code|preformatted|verse|shortcode|table)(?: \{[\s\S]*?\})? -->[\s\S]*?<!-- \/wp:\1 -->/g;
/** Conteúdo com estrutura de bloco dentro: não é um trecho simples de texto. */
const HAS_BLOCK_CHILD = /<(?:p|div|ul|ol|li|h[1-6]|table|figure|blockquote|pre)\b/i;

/**
 * Os trechos de texto que a tela deixa editar, na ordem em que aparecem. Ficam de fora o que não é
 * texto simples (imagem, embed, código, tabela), o bloco gerenciado pelo sistema (widget que é
 * regerado) e elementos com estrutura dentro (lista dentro de lista).
 */
export function findEditableTexts(html: string): EditableText[] {
  const excluded: Array<[number, number]> = [];
  for (const m of html.matchAll(NON_TEXT_BLOCK)) excluded.push([m.index!, m.index! + m[0]!.length]);
  for (const m of html.matchAll(MANAGED_RANGE)) excluded.push([m.index!, m.index! + m[0]!.length]);
  const inExcluded = (pos: number) => excluded.some(([s, e]) => pos >= s && pos < e);

  const out: EditableText[] = [];
  for (const m of html.matchAll(TEXT_ELEMENT)) {
    if (inExcluded(m.index!)) continue;
    const inner = m[3]!;
    if (HAS_BLOCK_CHILD.test(inner)) continue;
    const openEnd = m.index! + 1 + m[1]!.length + m[2]!.length + 1;
    out.push({
      index: out.length,
      tag: m[1]!.toLowerCase() as EditableText['tag'],
      openStart: m.index!,
      openEnd,
      inner,
      innerStart: openEnd,
      innerEnd: openEnd + inner.length,
    });
  }
  return out;
}

/** Texto puro de um trecho: sem tags, entidades comuns decodificadas e espaços colapsados. */
export function plainText(inner: string): string {
  // tag de texto (negrito, link) nao separa palavras; so a quebra de linha vira espaco
  return decodeEntities(inner.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Para comparar o texto que o navegador viu com o do HTML: sem espaco nenhum, que e o que mais varia. */
const compact = (text: string) => text.replace(/\s+/g, '');

/**
 * Marca cada trecho editável com `data-edit-index`, para a tela saber qual trecho do HTML cada
 * elemento desenhado representa. É o mesmo índice que `applyTextEdits` usa ao salvar.
 */
export function markEditableTexts(html: string): string {
  const items = findEditableTexts(html);
  let out = html;
  for (const it of [...items].reverse()) {
    // logo antes do `>` da abertura
    out = out.slice(0, it.openEnd - 1) + ` data-edit-index="${it.index}"` + out.slice(it.openEnd - 1);
  }
  return out;
}

export interface TextEdit {
  index: number;
  /** O texto puro do trecho como o usuário o viu ao começar: se o WordPress mudou nesse meio tempo, não se sobrescreve. */
  beforeText: string;
  /** O conteúdo novo, JÁ sanitizado por quem chama (só marcação de texto). */
  afterHtml: string;
}

export type ApplyEditsResult =
  | { ok: true; html: string; changed: number }
  | { ok: false; reason: 'conflict' | 'missing' | 'empty'; index: number };

/**
 * Aplica as edições ao HTML do post. Antes de tocar em qualquer trecho confere que ele continua
 * como o usuário o viu: se alguém mudou aquele parágrafo no WordPress, a edição inteira é recusada
 * em vez de sobrescrever o trabalho dos outros. Tudo ou nada.
 */
export function applyTextEdits(html: string, edits: TextEdit[]): ApplyEditsResult {
  const items = findEditableTexts(html);
  const byIndex = new Map(items.map((i) => [i.index, i]));
  const planned: Array<{ item: EditableText; after: string }> = [];

  for (const e of edits) {
    const item = byIndex.get(e.index);
    if (!item) return { ok: false, reason: 'missing', index: e.index };
    if (compact(plainText(item.inner)) !== compact(e.beforeText.replace(/\u00a0/g, ' '))) return { ok: false, reason: 'conflict', index: e.index };
    const after = e.afterHtml.trim();
    if (!plainText(after)) return { ok: false, reason: 'empty', index: e.index };
    if (after !== item.inner.trim()) planned.push({ item, after });
  }

  let out = html;
  for (const { item, after } of planned.sort((a, b) => b.item.innerStart - a.item.innerStart)) {
    out = out.slice(0, item.innerStart) + after + out.slice(item.innerEnd);
  }
  return { ok: true, html: out, changed: planned.length };
}
