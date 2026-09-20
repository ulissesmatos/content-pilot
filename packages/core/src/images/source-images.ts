import type { ImageCandidate } from './openverse';

/**
 * Imagens das FONTES do artigo: a imagem de destaque (og:image) que o próprio
 * veículo escolheu para a matéria. É a imagem mais relevante possível para o
 * assunto, porque acompanha exatamente o texto que usamos de base, e costuma ter
 * boa resolução. Vem de página que já estamos citando, não de uma busca genérica.
 *
 * Licença é do veículo: a atribuição vai na legenda (ver `attribution`).
 */

/** Só o <head> importa, e ele fica no começo: não baixamos a página inteira. */
const MAX_HEAD_BYTES = 300_000;

export interface PageImageOptions {
  /** fetch a usar. Em produção, o `publicFetch` (bloqueia rede interna e redirect). */
  fetchImpl: typeof fetch;
  timeoutMs?: number;
  /** Máximo de páginas consultadas. */
  limit?: number;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  const raw = m?.[2] ?? m?.[3] ?? m?.[4];
  return raw === undefined ? null : decodeEntities(raw.trim());
}

/** Extrai og:image / twitter:image e o título da página de um trecho de HTML. */
export function parsePageImage(html: string, pageUrl: string): { imageUrl: string; title: string } | null {
  const head = html.slice(0, MAX_HEAD_BYTES);
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);

  const find = (keys: string[]): string | null => {
    for (const key of keys) {
      for (const tag of metas) {
        const name = (attr(tag, 'property') ?? attr(tag, 'name') ?? '').toLowerCase();
        if (name === key) {
          const content = attr(tag, 'content');
          if (content) return content;
        }
      }
    }
    return null;
  };

  const rawImage = find(['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']);
  if (!rawImage) return null;

  let imageUrl: string;
  try {
    imageUrl = new URL(rawImage, pageUrl).toString();
  } catch {
    return null;
  }
  if (!/^https?:\/\//i.test(imageUrl)) return null;

  const title = find(['og:title', 'twitter:title']) ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1]?.trim() ?? '';
  return { imageUrl, title: decodeEntities(title).replace(/\s+/g, ' ').trim() };
}

/** Lê no máximo `max` bytes do corpo e descarta o resto. */
async function readHead(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let out = '';
  let bytes = 0;
  while (bytes < max) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    out += decoder.decode(value, { stream: true });
    // </head> já chegou: o resto da página não interessa
    if (/<\/head>/i.test(out)) break;
  }
  await reader.cancel().catch(() => {});
  return out;
}

/**
 * Busca a imagem de destaque de cada página. Falha individual (site fora do ar,
 * sem og:image, resposta que não é HTML) só pula aquela página: imagem nunca
 * derruba o post.
 */
export async function fetchSourceImages(pageUrls: string[], opts: PageImageOptions): Promise<ImageCandidate[]> {
  const urls = [...new Set(pageUrls)].slice(0, opts.limit ?? 5);
  const settled = await Promise.all(
    urls.map(async (pageUrl): Promise<ImageCandidate | null> => {
      try {
        const res = await opts.fetchImpl(pageUrl, {
          headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'ContentPilotBot/1.0' },
          signal: AbortSignal.timeout(opts.timeoutMs ?? 8_000),
        });
        if (!res.ok) return null;
        const type = res.headers.get('content-type') ?? '';
        if (type && !/html/i.test(type)) {
          await res.body?.cancel().catch(() => {});
          return null;
        }
        const found = parsePageImage(await readHead(res, MAX_HEAD_BYTES), pageUrl);
        if (!found) return null;
        const host = new URL(pageUrl).hostname.replace(/^www\./, '');
        return {
          url: found.imageUrl,
          thumbnail: found.imageUrl,
          title: found.title,
          license: 'source',
          attribution: `Imagem: ${host}`,
          sourcePage: pageUrl,
          provider: 'source-page',
        };
      } catch {
        return null;
      }
    }),
  );
  return settled.filter((c): c is ImageCandidate => c !== null);
}
