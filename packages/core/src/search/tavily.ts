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

export interface SearchOptions {
  /** 'basic' custa menos créditos Tavily; 'advanced' traz raw_content mais completo. */
  depth?: 'basic' | 'advanced';
  maxResults?: number;
}

/** Imagem encontrada na web para o tema buscado (Tavily include_images). */
export interface WebImageResult {
  url: string;
  description?: string;
}

export interface SearchClient {
  search(query: string, opts?: SearchOptions): Promise<TavilySearchResponse>;
  extract(urls: string[]): Promise<TavilyExtractResponse>;
  /**
   * Busca de imagens da web sobre o tema (opcional — nem todo provedor tem).
   * As imagens vêm das páginas que cobrem o assunto, então tendem a ser muito
   * mais relevantes que acervos genéricos de licença aberta.
   */
  searchImages?(query: string, opts?: { limit?: number }): Promise<WebImageResult[]>;
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
  async search(query: string, opts: SearchOptions = {}): Promise<TavilySearchResponse> {
    try {
      const res = await fetchWithRetry(
        new URL('search', this.baseUrl).toString(),
        {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({
            query,
            search_depth: opts.depth ?? 'advanced',
            include_raw_content: true,
            max_results: opts.maxResults ?? 20,
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

  /** Imagens das páginas que cobrem o tema. Falha vira lista vazia (imagem nunca derruba o post). */
  async searchImages(query: string, opts: { limit?: number } = {}): Promise<WebImageResult[]> {
    const limit = Math.min(Math.max(opts.limit ?? 8, 1), 20);
    try {
      const res = await fetchWithRetry(
        new URL('search', this.baseUrl).toString(),
        {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({
            query,
            search_depth: 'basic',
            include_raw_content: false,
            include_images: true,
            include_image_descriptions: true,
            max_results: limit,
          }),
        },
        { timeoutMs: 30_000, retries: 2, retryDelayMs: 3_000 },
      );
      const json = (await res.json()) as { images?: Array<string | { url?: string; description?: string }> };
      const images = Array.isArray(json.images) ? json.images : [];
      return images
        .map((img) => (typeof img === 'string' ? { url: img } : { url: img.url ?? '', description: img.description }))
        .filter((img) => /^https?:\/\//.test(img.url))
        .slice(0, limit);
    } catch (err) {
      // A capa é opcional, mas esconder 401/429/timeout torna impossível
      // distinguir "não havia imagem" de uma falha de configuração.
      console.warn('[tavily] busca de imagens falhou', err instanceof Error ? err.message : String(err));
      return [];
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
