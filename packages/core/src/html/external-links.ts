import { normalizeUrl } from '../search/normalize';

/**
 * Sanitização anti-alucinação de links externos — mesma filosofia da checagem
 * verbatim dos códigos: o LLM só pode linkar para URLs que realmente vimos nas
 * fontes da busca. Qualquer <a> externo cujo href não esteja no conjunto
 * permitido é desfeito (mantém o texto, remove o link). Links internos
 * (relativos, âncoras, ou do próprio site) passam sem checagem.
 */

export interface SanitizeLinksResult {
  html: string;
  /** Quantos links externos válidos permaneceram. */
  kept: number;
  /** Hrefs removidos por não constarem nas fontes (possível alucinação). */
  stripped: string[];
}

const ANCHOR_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const HREF_RE = /href\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

function isExternalHttp(href: string): boolean {
  return /^https?:\/\//i.test(href.trim());
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Remove links externos não presentes em `allowedUrls`. `siteBaseUrl` (opcional)
 * marca o domínio do próprio site como interno (links internos são sempre OK).
 */
export function sanitizeExternalLinks(
  html: string,
  allowedUrls: string[],
  opts: { siteBaseUrl?: string } = {},
): SanitizeLinksResult {
  const allowed = new Set(allowedUrls.map((u) => normalizeUrl(u)).filter(Boolean));
  const siteHost = opts.siteBaseUrl ? hostOf(opts.siteBaseUrl) : '';
  const stripped: string[] = [];
  let kept = 0;

  const out = html.replace(ANCHOR_RE, (full, attrs: string, inner: string) => {
    const m = HREF_RE.exec(attrs);
    const href = (m?.[1] ?? m?.[2] ?? '').trim();
    if (!href || !isExternalHttp(href)) return full; // interno/relativo/âncora → mantém

    // link para o próprio site é interno
    if (siteHost && hostOf(href) === siteHost) {
      kept++;
      return full;
    }
    if (allowed.has(normalizeUrl(href))) {
      kept++;
      return full;
    }
    stripped.push(href);
    return inner; // desfaz o link, preserva o texto
  });

  return { html: out, kept, stripped };
}
