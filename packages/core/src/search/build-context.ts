import { normalizeText, normalizeUrl } from './normalize';
import type { SourceCandidate } from './select-sources';
import type { TavilyExtractResult } from './tavily';

/**
 * Monta o searchContext a partir dos candidatos + resultados do Extract —
 * porta exata do "Code - Parse Results" do n8n (fallback para raw_content do
 * search quando o extract falha, limites por fonte e total).
 */

export interface BuildContextConfig {
  perSourceCharLimit: number; // 30_000 no seed
  contextCharLimit: number; // 180_000 no seed
}

export interface ContextSource {
  title: string;
  url: string;
  snippet: string;
  trusted: boolean;
  sourceSearches: string[];
  rawContentChars: number;
  extractedContentChars: number;
  contextChars: number;
}

export interface BuildContextResult {
  searchContext: string;
  sources: ContextSource[];
  resultsCount: number;
  extractedResultsCount: number;
}

export function buildSearchContext(
  candidates: SourceCandidate[],
  extractResults: TavilyExtractResult[],
  cfg: BuildContextConfig,
): BuildContextResult {
  const extractedByUrl = new Map<string, string>();
  for (const item of extractResults) {
    if (!item?.url) continue;
    const text = normalizeText(item.raw_content ?? item.content ?? item.text ?? '');
    if (!text) continue;
    extractedByUrl.set(normalizeUrl(item.url), text);
  }

  const top = candidates.map((r) => {
    const extractedText = extractedByUrl.get(normalizeUrl(r.url)) ?? '';
    const fallbackText = normalizeText(r.searchText || r.snippet || '');
    let sourceText: string;
    if (extractedText && fallbackText) {
      const extractedNorm = extractedText.toLowerCase();
      const fallbackSample = fallbackText.slice(0, 500).toLowerCase();
      sourceText =
        fallbackSample && extractedNorm.includes(fallbackSample)
          ? extractedText
          : extractedText + '\n\n--- RAW_CONTENT DO SEARCH (fallback complementar) ---\n' + fallbackText;
    } else {
      sourceText = extractedText || fallbackText || '(sem conteúdo textual retornado)';
    }
    return {
      ...r,
      sourceText: sourceText.slice(0, cfg.perSourceCharLimit),
      extractedContentChars: extractedText.length,
      contextChars: Math.min(sourceText.length, cfg.perSourceCharLimit),
    };
  });

  const searchContext = top
    .map((r, index) => {
      const labels = r.sourceSearches.join(', ');
      const queries = r.sourceQueries.length ? '\nConsultas: ' + r.sourceQueries.join(' | ') : '';
      const published = r.publishedDate ? '\nData detectada: ' + r.publishedDate : '';
      const extraction =
        r.extractedContentChars > 0
          ? `\nConteúdo aberto via Tavily Extract advanced: sim (${r.extractedContentChars} chars extraídos)`
          : '\nConteúdo aberto via Tavily Extract advanced: não; usando raw_content do Search';
      return (
        `FONTE ${index + 1} [${labels}]\n[${r.title}](${r.url})` + queries + published + extraction + '\n\n' + r.sourceText
      );
    })
    .join('\n\n---\n\n')
    .slice(0, cfg.contextCharLimit);

  return {
    searchContext,
    sources: top.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      trusted: r.trusted,
      sourceSearches: r.sourceSearches,
      rawContentChars: r.rawContentChars,
      extractedContentChars: r.extractedContentChars,
      contextChars: r.contextChars,
    })),
    resultsCount: top.length,
    extractedResultsCount: extractedByUrl.size,
  };
}
