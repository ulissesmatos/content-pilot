/**
 * Embeds (vídeo do YouTube, tweet) que entram no artigo como bloco nativo do
 * Gutenberg. O WordPress transforma a URL em player/cartão na hora de exibir, então
 * o que gravamos é só a URL canônica dentro do bloco `wp:embed`.
 *
 * Este módulo é o parser estrito: só devolve URL que reconhece de verdade. A URL
 * que chega aqui vem de uma busca real, e o LLM nunca a escreve.
 */

export type EmbedKind = 'youtube' | 'tweet';

export interface EmbedItem {
  kind: EmbedKind;
  /** URL canônica: a que vai dentro do bloco e a que a tela de preview usa. */
  url: string;
  /** YouTube: id do vídeo. Tweet: id da publicação. */
  id: string;
  title: string;
  /** Canal ou conta. */
  author: string;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** Id do vídeo em watch?v=, youtu.be/, /embed/, /shorts/ e /live/. */
export function parseYoutubeId(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.replace(/^(www|m|music)\./, '').toLowerCase();

  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else {
      const m = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(url.pathname);
      id = m?.[1] ?? null;
    }
  }
  return id && YT_ID.test(id) ? id : null;
}

export const canonicalYoutubeUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

/** Usuário e id de um link de tweet (twitter.com ou x.com). */
export function parseTweet(input: string): { user: string; id: string } | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.replace(/^(www|mobile)\./, '').toLowerCase();
  if (host !== 'twitter.com' && host !== 'x.com') return null;
  const m = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})(?:\/|$)/.exec(url.pathname);
  return m ? { user: m[1]!, id: m[2]! } : null;
}

/**
 * twitter.com em vez de x.com: é o que qualquer versão do WordPress reconhece
 * como provedor de embed. Versões antigas não conhecem o domínio novo.
 */
export const canonicalTweetUrl = (t: { user: string; id: string }) => `https://twitter.com/${t.user}/status/${t.id}`;

/** Bloco Gutenberg `core/embed`, na forma exata em que o editor o serializa. */
export function embedBlock(e: Pick<EmbedItem, 'kind' | 'url'>): string {
  if (e.kind === 'youtube') {
    return (
      `\n<!-- wp:embed {"url":"${e.url}","type":"video","providerNameSlug":"youtube","responsive":true,"className":"wp-embed-aspect-16-9 wp-has-aspect-ratio"} -->\n` +
      `<figure class="wp-block-embed is-type-video is-provider-youtube wp-block-embed-youtube wp-embed-aspect-16-9 wp-has-aspect-ratio"><div class="wp-block-embed__wrapper">\n${e.url}\n</div></figure>\n` +
      `<!-- /wp:embed -->\n`
    );
  }
  return (
    `\n<!-- wp:embed {"url":"${e.url}","type":"rich","providerNameSlug":"twitter","responsive":true} -->\n` +
    `<figure class="wp-block-embed is-type-rich is-provider-twitter wp-block-embed-twitter"><div class="wp-block-embed__wrapper">\n${e.url}\n</div></figure>\n` +
    `<!-- /wp:embed -->\n`
  );
}
