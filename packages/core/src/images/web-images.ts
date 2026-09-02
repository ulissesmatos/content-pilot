import type { SearchClient } from '../search/tavily';
import type { ImageCandidate, ImageSearchClient, ImageSearchOptions } from './openverse';

/**
 * Imagens da web via provedor de busca (Tavily include_images): as candidatas
 * vêm das próprias páginas que cobrem o tema, então a relevância visual é muito
 * maior que a de acervos genéricos. A licença é desconhecida — o usuário revisa
 * e substitui o que quiser antes/depois de publicar (decisão de produto).
 */
export class WebImageSearchClient implements ImageSearchClient {
  constructor(private readonly searchClient: SearchClient) {}

  async search(query: string, opts: ImageSearchOptions = {}): Promise<ImageCandidate[]> {
    if (!this.searchClient.searchImages) return [];
    const images = await this.searchClient.searchImages(query, { limit: opts.limit ?? 8 });
    return images.map((img) => ({
      url: img.url,
      thumbnail: img.url,
      title: img.description ?? '',
      license: 'web',
      // sem crédito automático: licença desconhecida — nada de legenda inventada
      attribution: '',
      sourcePage: img.url,
      provider: 'web',
    }));
  }
}

/**
 * Combina provedores de imagem preservando a ordem (o primeiro é o de maior
 * prioridade — ex.: web primeiro, Openverse como reforço) e deduplicando por
 * URL. Falha individual de um provedor não derruba a busca.
 */
export function combineImageClients(clients: ImageSearchClient[]): ImageSearchClient {
  return {
    async search(query: string, opts: ImageSearchOptions = {}): Promise<ImageCandidate[]> {
      const lists = await Promise.all(clients.map((c) => c.search(query, opts).catch(() => [] as ImageCandidate[])));
      const seen = new Set<string>();
      const out: ImageCandidate[] = [];
      for (const list of lists) {
        for (const candidate of list) {
          if (seen.has(candidate.url)) continue;
          seen.add(candidate.url);
          out.push(candidate);
        }
      }
      return out;
    },
  };
}
