import { parseTweet, parseYoutubeId } from '../embeds/parse';
import { gutenbergImageBlock, type InlineImage } from './inline-images';

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
