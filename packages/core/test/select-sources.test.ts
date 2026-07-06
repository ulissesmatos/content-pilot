import { describe, expect, it } from 'vitest';
import { normalizeUrl } from '../src/search/normalize';
import { selectSources, type SearchBucket } from '../src/search/select-sources';

const CFG = {
  blocklist: ['youtube.com', 'cuponomia.com'],
  trustlist: ['progameguides.com'],
  sourceLimit: 20,
  perQueryQuota: 6,
};

function bucket(name: string, urls: Array<{ url: string; raw?: string; content?: string }>): SearchBucket {
  return {
    name,
    query: `q-${name}`,
    results: urls.map((u, i) => ({
      title: `t${i}`,
      url: u.url,
      content: u.content ?? 'snippet',
      raw_content: u.raw ?? null,
    })),
  };
}

describe('normalizeUrl', () => {
  it('remove www, hash, utm/fbclid/gclid e barra final', () => {
    expect(normalizeUrl('https://www.Ex.com/a/?utm_source=x&fbclid=y&keep=1#frag')).toBe('https://ex.com/a?keep=1');
    expect(normalizeUrl('https://ex.com/a/')).toBe('https://ex.com/a');
  });
});

describe('selectSources', () => {
  it('bloqueia blocklist e deduplica por URL normalizada', () => {
    const r = selectSources(
      [
        bucket('a', [
          { url: 'https://youtube.com/watch?v=1' },
          { url: 'https://www.site.com/post/?utm_source=z' },
          { url: 'https://site.com/post' },
        ]),
      ],
      CFG,
    );
    expect(r.candidates.length).toBe(1);
    expect(r.candidates[0]!.url).toContain('site.com/post');
  });

  it('prioriza fontes confiáveis sobre rank', () => {
    const r = selectSources(
      [
        bucket('a', [
          { url: 'https://random.com/1' },
          { url: 'https://random.com/2' },
          { url: 'https://progameguides.com/codes' },
        ]),
      ],
      CFG,
    );
    expect(r.candidates[0]!.url).toContain('progameguides');
    expect(r.hasTrustedSource).toBe(true);
  });

  it('distribui quota por bucket antes de completar', () => {
    const many = (host: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({ url: `https://${host}/p${i}` }));
    const r = selectSources(
      [bucket('en', many('en.com', 15)), bucket('pt', many('pt.com', 15))],
      { ...CFG, sourceLimit: 10, perQueryQuota: 4 },
    );
    const ptCount = r.candidates.filter((c) => c.url.includes('pt.com')).length;
    expect(ptCount).toBeGreaterThanOrEqual(4);
    expect(r.candidates.length).toBe(10);
  });

  it('merge de duplicados preserva trusted, melhor rank e maior texto', () => {
    const r = selectSources(
      [
        bucket('a', [{ url: 'https://progameguides.com/x', raw: 'texto curto' }]),
        bucket('b', [{ url: 'https://www.progameguides.com/x/', raw: 'texto bem mais longo com códigos ABC123' }]),
      ],
      CFG,
    );
    expect(r.candidates.length).toBe(1);
    const c = r.candidates[0]!;
    expect(c.trusted).toBe(true);
    expect(c.sourceSearches.sort()).toEqual(['a', 'b']);
    expect(c.searchText).toContain('ABC123');
  });
});
