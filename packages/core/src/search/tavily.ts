import { fetchWithRetry } from '../http/fetch-retry';

/** Cliente Tavily — search advanced com raw_content + extract advanced markdown. */

export interface TavilySearchResult {
  title?: string;
  url: string;
  content?: string;
  raw_content?: string | null;
  published_date?: string;
}

export interface TavilySearchResponse {
  results: TavilySearchResult[];
  /** Preenchido quando a busca falhou — o pipeline tolera falha individual. */
  error?: string;
}

export interface TavilyExtractResult {
  url: string;
  raw_content?: string;
  content?: string;
  text?: string;
}

export interface TavilyExtractResponse {
  results: TavilyExtractResult[];
  failed_results: unknown[];
  error?: string;
}

export interface SearchClient {
  search(query: string): Promise<TavilySearchResponse>;
  extract(urls: string[]): Promise<TavilyExtractResponse>;
}

export class TavilyClient implements SearchClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.tavily.com/',
  ) {}

  private headers() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  /** Falha vira `{results: [], error}` — mesmo comportamento do onError: continueRegularOutput do n8n. */
  async search(query: string): Promise<TavilySearchResponse> {
    try {
      const res = await fetchWithRetry(
        new URL('search', this.baseUrl).toString(),
        {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({
            query,
            search_depth: 'advanced',
            include_raw_content: true,
            max_results: 20,
          }),
        },
        { timeoutMs: 60_000, retries: 3, retryDelayMs: 5_000 },
      );
      const json = (await res.json()) as { results?: TavilySearchResult[] };
      return { results: Array.isArray(json.results) ? json.results : [] };
    } catch (err) {
      return { results: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  async extract(urls: string[]): Promise<TavilyExtractResponse> {
    if (urls.length === 0) return { results: [], failed_results: [] };
    try {
      const res = await fetchWithRetry(
        new URL('extract', this.baseUrl).toString(),
        {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({
            urls,
            extract_depth: 'advanced',
            format: 'markdown',
            include_images: false,
            timeout: 60,
          }),
        },
        { timeoutMs: 180_000, retries: 2, retryDelayMs: 5_000 },
      );
      const json = (await res.json()) as { results?: TavilyExtractResult[]; failed_results?: unknown[] };
      return {
        results: Array.isArray(json.results) ? json.results : [],
        failed_results: Array.isArray(json.failed_results) ? json.failed_results : [],
      };
    } catch (err) {
      return { results: [], failed_results: [], error: err instanceof Error ? err.message : String(err) };
    }
  }
}
