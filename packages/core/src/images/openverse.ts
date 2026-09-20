import { fetchWithRetry } from '../http/fetch-retry';

/**
 * Busca de imagens via Openverse (agregador de mídia com licença aberta do
 * WordPress.org). Escolhido como default por NÃO exigir API key — o cliente
 * SaaS não precisa configurar nada. Filtramos por uso comercial e conteúdo
 * seguro. Sem scraping: só a API oficial, com atribuição preservada.
 */

export interface ImageCandidate {
  /** URL da imagem em tamanho cheio (para download/upload). */
  url: string;
  /** Miniatura — usada na checagem de relevância por visão (mais barata). */
  thumbnail: string;
  title: string;
  license: string;
  /** Crédito legível (autor + licença) para exibir/registrar. */
  attribution: string;
  /** Página de origem da imagem. */
  sourcePage: string;
  provider: string;
}

export interface ImageSearchOptions {
  limit?: number;
}

export interface ImageSearchClient {
  search(query: string, opts?: ImageSearchOptions): Promise<ImageCandidate[]>;
}

interface OpenverseResult {
  id: string;
  title?: string;
  url?: string;
  thumbnail?: string;
  license?: string;
  license_version?: string;
  creator?: string;
  foreign_landing_url?: string;
  attribution?: string;
}

export class OpenverseClient implements ImageSearchClient {
  constructor(private readonly baseUrl = 'https://api.openverse.org/') {}

  async search(query: string, opts: ImageSearchOptions = {}): Promise<ImageCandidate[]> {
    const params = new URLSearchParams({
      q: query,
      page_size: String(opts.limit ?? 5),
      license_type: 'commercial', // seguro para publicar em blog
      mature: 'false',
    });
    try {
      const res = await fetchWithRetry(
        new URL(`v1/images/?${params}`, this.baseUrl).toString(),
        { method: 'GET', headers: { Accept: 'application/json' } },
        { timeoutMs: 20_000, retries: 2, retryDelayMs: 3_000 },
      );
      const json = (await res.json()) as { results?: OpenverseResult[] };
      const results = Array.isArray(json.results) ? json.results : [];
      return results
        .filter((r) => r.url && r.thumbnail)
        .map((r) => ({
          url: r.url!,
          thumbnail: r.thumbnail!,
          title: r.title ?? '',
          license: [r.license, r.license_version].filter(Boolean).join(' ').toUpperCase(),
          attribution:
            r.attribution ??
            [r.creator, r.license && `(${r.license.toUpperCase()} ${r.license_version ?? ''})`.trim()]
              .filter(Boolean)
              .join(' '),
          sourcePage: r.foreign_landing_url ?? r.url!,
          provider: 'openverse',
        }));
    } catch (err) {
      console.warn('[openverse] busca de imagens falhou', err instanceof Error ? err.message : String(err));
      return []; // busca de imagem nunca derruba a geração do post
    }
  }
}
