/**
 * Normalização de texto compartilhada: remoção de acentos e slug de URL.
 * Fonte única — a mesma lógica estava duplicada no worker (slug de post,
 * nome de arquivo de imagem) e no core (tokens de dedup, rank de imagens).
 */

/** Remove diacríticos (acentos) preservando o restante do texto. */
export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export interface SlugifyOptions {
  /** Comprimento máximo do slug (corta no limite; sem corte por default). */
  maxLength?: number;
  /** Valor devolvido quando o texto não gera slug (default: ''). */
  fallback?: string;
}

/** Slug de URL: minúsculas, sem acento, [a-z0-9] com hífens. */
export function slugify(text: string, opts: SlugifyOptions = {}): string {
  let slug = stripDiacritics(text.toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  if (opts.maxLength && slug.length > opts.maxLength) {
    slug = slug.slice(0, opts.maxLength).replace(/-$/, '');
  }
  return slug || (opts.fallback ?? '');
}
