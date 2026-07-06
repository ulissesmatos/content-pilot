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
  getPost(id: number): Promise<CmsPost>;
  updatePost(id: number, patch: CmsUpdatePostInput): Promise<CmsPost>;
  createPost(input: CmsCreatePostInput): Promise<CmsPost>;
  listCategories(): Promise<CmsTerm[]>;
  listTags(): Promise<CmsTerm[]>;
}
