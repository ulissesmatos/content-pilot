import { includesSnippet, normalizeText, normalizeUrl } from './normalize';
import type { TavilySearchResult } from './tavily';

/**
 * Seleção de fontes — porta exata do "Code - Select Source URLs" do n8n,
 * generalizando os 4 buckets fixos (en/pt × atual/anterior) para N buckets
 * nomeados vindos das queries do template, e block/trust lists configuráveis.
 */

export interface SearchBucket {
  name: string;
  query: string;
  results: TavilySearchResult[];
}

export interface SourceSelectionConfig {
  blocklist: string[];
  trustlist: string[];
  sourceLimit: number;
  perQueryQuota: number;
}

export interface SourceCandidate {
  key: string;
  title: string;
  url: string;
  publishedDate: string | null;
  snippet: string;
  searchText: string;
  trusted: boolean;
  sourceSearches: string[];
  sourceQueries: string[];
  bestRank: number;
  rawContentChars: number;
}

const SEARCH_RAW_FALLBACK_LIMIT = 30_000;

export interface SourceSelectionResult {
  candidates: SourceCandidate[];
  totalMergedResultsCount: number;
  rawContentResultsCount: number;
  hasTrustedSource: boolean;
  perBucketCounts: Record<string, number>;
}

export function selectSources(buckets: SearchBucket[], cfg: SourceSelectionConfig): SourceSelectionResult {
  const byUrl = new Map<string, SourceCandidate>();

  for (const bucket of buckets) {
    bucket.results.forEach((r, index) => {
      if (!r?.url) return;
      const url = String(r.url).trim();
      const urlLower = url.toLowerCase();
      if (cfg.blocklist.some((b) => urlLower.includes(b))) return;

      const rawContent = normalizeText(r.raw_content ?? '');
      const snippet = normalizeText(r.content ?? '');
      const searchText = rawContent
        ? includesSnippet(rawContent, snippet)
          ? rawContent
          : snippet + '\n\n' + rawContent
        : snippet;

      const key = normalizeUrl(url);
      const trusted = cfg.trustlist.some((t) => urlLower.includes(t));
      const candidate: SourceCandidate = {
        key,
        title: r.title ?? '',
        url,
        publishedDate: r.published_date ?? null,
        snippet: snippet.slice(0, 2500),
        searchText: searchText.slice(0, SEARCH_RAW_FALLBACK_LIMIT),
        trusted,
        sourceSearches: [bucket.name],
        sourceQueries: [bucket.query].filter(Boolean),
        bestRank: index + 1,
        rawContentChars: rawContent.length,
      };

      const existing = byUrl.get(key);
      if (!existing) {
        byUrl.set(key, candidate);
        return;
      }
      existing.trusted = existing.trusted || candidate.trusted;
      existing.bestRank = Math.min(existing.bestRank, candidate.bestRank);
      existing.sourceSearches = Array.from(new Set([...existing.sourceSearches, ...candidate.sourceSearches]));
      existing.sourceQueries = Array.from(new Set([...existing.sourceQueries, ...candidate.sourceQueries]));
      existing.rawContentChars = Math.max(existing.rawContentChars, candidate.rawContentChars);
      if (!existing.publishedDate && candidate.publishedDate) existing.publishedDate = candidate.publishedDate;
      if (candidate.searchText.length > existing.searchText.length) {
        existing.searchText = candidate.searchText;
        existing.snippet = candidate.snippet || existing.snippet;
      }
    });
  }

  const clean = Array.from(byUrl.values()).sort((a, b) => {
    const trustDelta = (b.trusted ? 1 : 0) - (a.trusted ? 1 : 0);
    if (trustDelta) return trustDelta;
    return a.bestRank - b.bestRank;
  });

  const selected: SourceCandidate[] = [];
  const selectedKeys = new Set<string>();

  const addSource = (r: SourceCandidate | undefined) => {
    if (!r || selectedKeys.has(r.key) || selected.length >= cfg.sourceLimit) return;
    selected.push(r);
    selectedKeys.add(r.key);
  };

  // Distribui a cobertura entre os buckets (idioma × recência) antes de completar por rank
  for (const bucket of buckets) {
    clean
      .filter((r) => r.sourceSearches.includes(bucket.name))
      .slice(0, cfg.perQueryQuota)
      .forEach(addSource);
  }
  clean.forEach(addSource);

  const candidates = selected.slice(0, cfg.sourceLimit);
  const perBucketCounts: Record<string, number> = {};
  for (const bucket of buckets) perBucketCounts[bucket.name] = bucket.results.length;

  return {
    candidates,
    totalMergedResultsCount: clean.length,
    rawContentResultsCount: clean.filter((r) => r.rawContentChars > 0).length,
    hasTrustedSource: candidates.some((r) => r.trusted),
    perBucketCounts,
  };
}
