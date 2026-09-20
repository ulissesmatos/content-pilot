import { and, briefs, contentTemplates, eq, getTenantDb, sites } from '@content-pilot/db';
import {
  markEditableTexts,
  parseEditorialReport,
  parseImageReport,
  parseTemplateConfig,
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
    /** Só dá para editar imagem do texto e o texto quando o WordPress devolveu o conteúdo em blocos. */
    editable: boolean;
    segments: ArticleSegment[];
  } | null;
  /** Por que o texto não foi carregado; os relatórios continuam disponíveis. */
  postError: string | null;
  images: ImageReport;
  editorial: EditorialReport | null;
  /** Tamanho final das imagens do template: a tela diz o que vai acontecer com a imagem enviada. */
  imageSizes: { cover: { width: number; height: number }; inline: { width: number; height: number } };
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
    .select({ brief: briefs, siteName: sites.name, templateName: contentTemplates.name, templateConfig: contentTemplates.config })
    .from(briefs)
    .innerJoin(sites, eq(briefs.siteId, sites.id))
    .innerJoin(contentTemplates, eq(briefs.templateId, contentTemplates.id))
    .where(and(eq(briefs.id, briefId), eq(briefs.workspaceId, workspaceId)))
    .limit(1);
  if (!row) return null;

  const { brief } = row;
  const images = parseImageReport(brief.imageReport);
  const imageSizes = (() => {
    try {
      const cfg = parseTemplateConfig(row.templateConfig).images;
      return { cover: cfg.cover, inline: cfg.inline };
    } catch {
      // template com config torto: o padrão do sistema, para a tela não quebrar
      return { cover: { width: 1280, height: 720 }, inline: { width: 1280, height: 720 } };
    }
  })();
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
        editable: !p.usedRenderedFallback,
        // cada trecho de texto editável ganha um índice; é o mesmo que o servidor usa ao salvar
        segments: toSafeSegments(splitArticle(p.usedRenderedFallback ? p.contentRaw : markEditableTexts(p.contentRaw))),
      };
    } catch (err) {
      postError = err instanceof Error ? err.message : String(err);
    }
  }

  return { brief, siteName: row.siteName, templateName: row.templateName, post, postError, images, editorial, imageSizes };
}
