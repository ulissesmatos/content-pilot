import { fetchWithRetry, HttpError, type FetchRetryOptions } from '../http/fetch-retry';
import type {
  CmsAdapter,
  CmsConnectionResult,
  CmsCreatePostInput,
  CmsListPostsFilter,
  CmsPost,
  CmsTerm,
  CmsUpdatePostInput,
} from './types';

export interface WordPressCredentials {
  username: string;
  /** Application password do WP (Usuários → Perfil → Application Passwords). */
  appPassword: string;
}

interface WpPostResponse {
  id: number;
  title: { rendered?: string; raw?: string };
  content: { rendered?: string; raw?: string };
  slug: string;
  link: string;
  status?: string;
}

interface WpTermResponse {
  id: number;
  name: string;
  slug: string;
  count?: number;
}

/**
 * Adapter WordPress via REST API + Basic Auth (application password).
 * Detalhe crítico portado do workflow: listagem usa `context=edit` para
 * receber `content.raw` (HTML editável com comentários Gutenberg); sem isso
 * só vem o `rendered` e qualquer update viraria reescrita destrutiva.
 */
export class WordPressAdapter implements CmsAdapter {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(
    baseUrl: string,
    credentials: WordPressCredentials,
    private readonly fetchOpts: FetchRetryOptions = {},
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.authHeader =
      'Basic ' + Buffer.from(`${credentials.username}:${credentials.appPassword}`, 'utf8').toString('base64');
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetchWithRetry(
      `${this.baseUrl}/wp-json/wp/v2${path}`,
      {
        ...init,
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...init.headers,
        },
      },
      { timeoutMs: 60_000, retries: 3, retryDelayMs: 5_000, ...this.fetchOpts },
    );
    return (await res.json()) as T;
  }

  private toCmsPost(p: WpPostResponse): CmsPost {
    const raw = p.content?.raw;
    return {
      id: p.id,
      title: p.title?.raw ?? p.title?.rendered ?? '',
      slug: p.slug,
      link: p.link,
      contentRaw: raw ?? p.content?.rendered ?? '',
      usedRenderedFallback: raw === undefined,
      status: p.status,
    };
  }

  async testConnection(): Promise<CmsConnectionResult> {
    try {
      const me = await this.request<{ name: string; capabilities?: Record<string, boolean> }>(
        '/users/me?context=edit',
      );
      const canEdit = me.capabilities?.edit_posts === true;
      return { ok: true, user: me.name, canEdit };
    } catch (err) {
      if (err instanceof HttpError) {
        const hint =
          err.status === 401
            ? 'Credenciais inválidas (confira usuário e application password; o site precisa de HTTPS).'
            : err.status === 403
              ? 'Sem permissão (rest_forbidden) — o usuário precisa poder editar posts.'
              : err.status === 404
                ? 'REST API não encontrada — confira a URL base (sem /wp-admin) e se a REST API está habilitada.'
                : `Erro HTTP ${err.status}.`;
        return { ok: false, error: hint };
      }
      return { ok: false, error: err instanceof Error ? err.message : 'Erro de rede desconhecido' };
    }
  }

  async listPosts(filter: CmsListPostsFilter): Promise<CmsPost[]> {
    const params = new URLSearchParams({
      per_page: String(filter.perPage ?? 10),
      status: filter.status ?? 'publish',
      context: 'edit',
      _fields: 'id,title,content,slug,link,status',
    });
    if (filter.tags?.length) params.set('tags', filter.tags.join(','));
    if (filter.categories?.length) params.set('categories', filter.categories.join(','));

    const posts = await this.request<WpPostResponse[]>(`/posts?${params}`);
    return posts.map((p) => this.toCmsPost(p));
  }

  async getPost(id: number): Promise<CmsPost> {
    const post = await this.request<WpPostResponse>(
      `/posts/${id}?context=edit&_fields=id,title,content,slug,link,status`,
    );
    return this.toCmsPost(post);
  }

  async updatePost(id: number, patch: CmsUpdatePostInput): Promise<CmsPost> {
    const post = await this.request<WpPostResponse>(`/posts/${id}`, {
      method: 'POST',
      body: JSON.stringify(patch),
    });
    return this.toCmsPost(post);
  }

  async createPost(input: CmsCreatePostInput): Promise<CmsPost> {
    const post = await this.request<WpPostResponse>('/posts', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return this.toCmsPost(post);
  }

  async listCategories(): Promise<CmsTerm[]> {
    return this.listTerms('/categories');
  }

  async listTags(): Promise<CmsTerm[]> {
    return this.listTerms('/tags');
  }

  private async listTerms(path: string): Promise<CmsTerm[]> {
    // pagina até 100 por página; blogs raramente passam de poucas centenas de termos
    const all: CmsTerm[] = [];
    for (let page = 1; page <= 5; page++) {
      const terms = await this.request<WpTermResponse[]>(
        `${path}?per_page=100&page=${page}&_fields=id,name,slug,count`,
      );
      all.push(...terms.map((t) => ({ id: t.id, name: t.name, slug: t.slug, count: t.count })));
      if (terms.length < 100) break;
    }
    return all;
  }
}
