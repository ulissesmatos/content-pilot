/** Normalizações de URL e texto — porta exata do workflow n8n v4. */

export function normalizeUrl(url: unknown): string {
  const raw = String(url ?? '').trim();
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (/^(utm_|fbclid|gclid|mc_|ref$|ref_src$)/i.test(key)) parsed.searchParams.delete(key);
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/g, '');
    return parsed.toString().replace(/\/+$/g, '');
  } catch {
    return raw
      .toLowerCase()
      .replace(/#.*$/, '')
      .replace(/[?&](utm_[^=&]+|fbclid|gclid|ref)=[^&]*/gi, '')
      .replace(/\/+$/g, '');
  }
}

export function normalizeText(text: unknown): string {
  return String(text ?? '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function includesSnippet(rawContent: string, snippet: string): boolean {
  const sample = normalizeText(snippet).slice(0, 300).toLowerCase();
  if (!sample) return true;
  return normalizeText(rawContent).toLowerCase().includes(sample);
}
