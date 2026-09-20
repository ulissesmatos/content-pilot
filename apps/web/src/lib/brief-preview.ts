import { and, briefs, contentTemplates, eq, getTenantDb, sites } from '@content-pilot/db';
import {
  parseEditorialReport,
  parseImageReport,
  splitArticle,
  type ArticleSegment,
  type EditorialReport,
  type ImageReport,
} from '@content-pilot/core';
import { getWordPressForSite } from '@/lib/wp';
import { sanitizeArticleHtml } from '@/lib/sanitize-article';

/**
 * Tudo o que a tela de preview de um artigo precisa: a pauta, o texto ATUAL do
 * WordPress (o usuário pode ter editado lá) já separado em blocos e sanitizado, e
 * os relatórios que a geração deixou (imagens e revisão editorial).
 */

export interface BriefPreview {
  brief: typeof briefs.$inferSelect;
  siteName: string;
  templateName: string;
  post: {
    title: string;
    link: string;
    /** Status do post no WordPress, que pode diferir do da pauta se o usuário mexeu por lá. */
    wpStatus: string | null;
    /** O post tem imagem destacada no WordPress agora (fonte da verdade sobre a capa). */
    hasCover: boolean;
    segments: ArticleSegment[];
  } | null;
  /** Por que o texto não foi carregado; os relatórios continuam disponíveis. */
  postError: string | null;
  images: ImageReport;
  editorial: EditorialReport | null;
}

const isHttp = (u: string) => /^https?:\/\//i.test(u);

/** Texto sanitizado; URL de imagem ou embed que não seja http(s) é descartada. */
export function toSafeSegments(segments: ArticleSegment[]): ArticleSegment[] {
  const out: ArticleSegment[] = [];
  for (const s of segments) {
    if (s.kind === 'html') {
      const html = sanitizeArticleHtml(s.html);
      if (html.trim()) out.push({ kind: 'html', html });
    } else if (s.kind === 'image') {
      if (isHttp(s.url)) out.push(s);
    } else if (s.provider === 'other') {
      if (isHttp(s.url)) out.push(s);
    } else {
      out.push(s);
    }
  }
  return out;
}

export async function loadBriefPreview(workspaceId: string, briefId: string): Promise<BriefPreview | null> {
  const db = getTenantDb(workspaceId);
  const [row] = await db
    .select({ brief: briefs, siteName: sites.name, templateName: contentTemplates.name })
    .from(briefs)
    .innerJoin(sites, eq(briefs.siteId, sites.id))
    .innerJoin(contentTemplates, eq(briefs.templateId, contentTemplates.id))
    .where(and(eq(briefs.id, briefId), eq(briefs.workspaceId, workspaceId)))
    .limit(1);
  if (!row) return null;

  const { brief } = row;
  const images = parseImageReport(brief.imageReport);
  const editorial = parseEditorialReport(brief.editorialReport);

  let post: BriefPreview['post'] = null;
  let postError: string | null = null;
  if (brief.createdWpPostId) {
    try {
      const wp = await getWordPressForSite(workspaceId, brief.siteId);
      const p = await wp.getPost(brief.createdWpPostId);
      if (p.usedRenderedFallback) {
        // sem `content.raw` só há o HTML renderizado, sem os blocos: dá para ler, não para trocar imagem
        postError = 'O WordPress não devolveu o conteúdo editável (falta permissão de edição do usuário conectado).';
      }
      post = {
        title: p.title,
        link: p.link,
        wpStatus: p.status ?? null,
        hasCover: Boolean(p.featuredMediaId),
        segments: toSafeSegments(splitArticle(p.contentRaw)),
      };
    } catch (err) {
      postError = err instanceof Error ? err.message : String(err);
    }
  }

  return { brief, siteName: row.siteName, templateName: row.templateName, post, postError, images, editorial };
}
