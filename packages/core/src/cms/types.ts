/** Abstração de CMS — MVP implementa apenas WordPress; Ghost/Strapi são fase 2. */

export interface CmsPost {
  id: number;
  title: string;
  slug: string;
  link: string;
  /** Conteúdo bruto editável (content.raw no WP com context=edit). */
  contentRaw: string;
  /** true quando o CMS não devolveu o raw e caímos no rendered (flag de aviso). */
  usedRenderedFallback: boolean;
  status?: string;
}

export interface CmsTerm {
  id: number;
  name: string;
  slug: string;
  count?: number;
}

/** Resumo leve de post (sem conteúdo) — usado no dedup do Autopilot. */
export interface PostSummary {
  id: number;
  title: string;
  slug: string;
  link: string;
}

export interface CmsListPostsFilter {
  tags?: number[];
  categories?: number[];
  perPage?: number;
  status?: string;
}

export interface CmsCreatePostInput {
  title: string;
  content: string;
  slug?: string;
  excerpt?: string;
  status: 'draft' | 'publish';
  categories?: number[];
  /** ID de mídia (uploadMedia) para a imagem destacada. */
  featuredMediaId?: number;
}

export interface CmsMediaUpload {
  data: Uint8Array;
  filename: string;
  mimeType: string;
  /** Texto alternativo (acessibilidade/SEO). */
  alt?: string;
  /** Legenda/atribuição da imagem. */
  caption?: string;
}

export interface CmsMedia {
  id: number;
  sourceUrl: string;
}

export interface CmsUpdatePostInput {
  title?: string;
  content?: string;
  status?: string;
}

export interface CmsConnectionResult {
  ok: boolean;
  /** Nome do usuário autenticado, quando ok. */
  user?: string;
  /** Se o usuário tem permissão de edição (necessária para context=edit). */
  canEdit?: boolean;
  error?: string;
}

export interface CmsAdapter {
  testConnection(): Promise<CmsConnectionResult>;
  listPosts(filter: CmsListPostsFilter): Promise<CmsPost[]>;
  listRecentPostTitles(limit?: number): Promise<PostSummary[]>;
  getPost(id: number): Promise<CmsPost>;
  updatePost(id: number, patch: CmsUpdatePostInput): Promise<CmsPost>;
  createPost(input: CmsCreatePostInput): Promise<CmsPost>;
  uploadMedia(input: CmsMediaUpload): Promise<CmsMedia>;
  listCategories(): Promise<CmsTerm[]>;
  listTags(): Promise<CmsTerm[]>;
}
