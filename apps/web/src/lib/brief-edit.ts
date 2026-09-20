import { and, briefs, contentTemplates, eq, getTenantDb, runs } from '@content-pilot/db';
import {
  applyTextEdits,
  findEditableTexts,
  parseImageReport,
  parseTemplateConfig,
  processUploadedImage,
  publicFetch,
  replaceImageBlock,
  slugify,
  splitArticle,
  updateImageBlockSeo,
  withReplacedImage,
  MAX_UPLOAD_BYTES,
  type CmsAdapter,
  type CmsPost,
  type ImageReportItem,
  type TextEdit,
} from '@content-pilot/core';
import { UserFacingError } from '@/lib/errors';
import { sanitizeInlineHtml } from '@/lib/sanitize-article';
import { getWordPressForSite } from '@/lib/wp';

/**
 * Edição do artigo já criado, direto no painel: trocar uma imagem por outra do usuário (com SEO),
 * ajustar só o SEO de uma imagem e fazer ajustes básicos no texto. Tudo vai para o WordPress; o
 * painel não guarda cópia do conteúdo.
 *
 * Regras que valem para as três:
 *  - só artigo já criado no WordPress (rascunho ou publicado);
 *  - nada roda ao mesmo tempo que uma troca de imagem por IA do mesmo artigo (as duas leriam o
 *    mesmo HTML e uma apagaria a outra);
 *  - sem permissão de edição no WordPress o conteúdo em blocos não vem, e nada é alterado.
 */

export interface EditDeps {
  /** Injetável nos testes. */
  getWp?: (workspaceId: string, siteId: string) => Promise<CmsAdapter>;
}

export type ImageTarget = { kind: 'cover' } | { kind: 'inline'; mediaId: number };

export interface ImageSeo {
  alt: string;
  /** Título do item na biblioteca de mídia. */
  title: string;
  caption: string;
}

export const SEO_LIMITS = { alt: 300, title: 200, caption: 500, filename: 80 } as const;

interface Loaded {
  brief: typeof briefs.$inferSelect;
  wp: CmsAdapter;
  post: CmsPost;
  postId: number;
  images: ReturnType<typeof parseTemplateConfig>['images'];
}

async function load(workspaceId: string, briefId: string, deps: EditDeps, needBlocks: boolean): Promise<Loaded> {
  const db = getTenantDb(workspaceId);
  const [row] = await db
    .select({ brief: briefs, config: contentTemplates.config })
    .from(briefs)
    .innerJoin(contentTemplates, eq(briefs.templateId, contentTemplates.id))
    .where(and(eq(briefs.id, briefId), eq(briefs.workspaceId, workspaceId)))
    .limit(1);
  if (!row) throw new UserFacingError('Artigo não encontrado.', 'not_found');
  const { brief } = row;
  if ((brief.status !== 'ready_for_review' && brief.status !== 'published') || !brief.createdWpPostId) {
    throw new UserFacingError('O artigo precisa estar criado no WordPress para ser editado.');
  }

  const [busy] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.briefId, briefId), eq(runs.kind, 'update'), eq(runs.status, 'running')))
    .limit(1);
  if (busy) throw new UserFacingError('Há uma troca de imagem com IA em andamento neste artigo. Aguarde terminar.', 'busy');

  const wp = await (deps.getWp ?? getWordPressForSite)(workspaceId, brief.siteId);
  const post = await wp.getPost(brief.createdWpPostId);
  if (needBlocks && post.usedRenderedFallback) {
    throw new UserFacingError(
      'O WordPress não devolveu o conteúdo editável do post (o usuário conectado não tem permissão de edição). Nada foi alterado.',
    );
  }
  return { brief, wp, post, postId: brief.createdWpPostId, images: parseTemplateConfig(row.config).images };
}

const clean = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);

/** Nome de arquivo do WordPress: a parte legível, em minúsculas, sempre .webp. */
export function imageFileName(preferred: string | undefined, fallback: string): string {
  const base = (preferred ?? '').replace(/\.[a-z0-9]{2,5}$/i, '');
  return `${slugify(base || fallback, { maxLength: SEO_LIMITS.filename, fallback: 'imagem' })}.webp`;
}

export interface ReplaceResult {
  mediaId: number;
  url: string;
  width: number;
  height: number;
  sourceBytes: number;
  sourceWidth: number;
  sourceHeight: number;
  bytes: number;
  upscaled: boolean;
  fileName: string;
}

/** Troca uma imagem do artigo por outra enviada pelo usuário, convertida para WebP no tamanho do template. */
export async function replaceBriefImage(
  workspaceId: string,
  briefId: string,
  input: { target: ImageTarget; image: Uint8Array; seo: ImageSeo; filename?: string },
  deps: EditDeps = {},
): Promise<ReplaceResult> {
  const { brief, wp, post, postId, images } = await load(workspaceId, briefId, deps, input.target.kind === 'inline');
  const role = input.target.kind;

  if (input.target.kind === 'inline') {
    const mediaId = input.target.mediaId;
    const present = splitArticle(post.contentRaw).some((s) => s.kind === 'image' && s.mediaId === mediaId);
    if (!present) throw new UserFacingError('Essa imagem não está mais no post (foi removida ou trocada no WordPress). Nada foi alterado.', 'gone');
  }

  // A conversão vem ANTES de qualquer envio: arquivo ruim é recusado sem tocar no WordPress.
  const processed = await processUploadedImage(input.image, {
    size: role === 'cover' ? images.cover : images.inline,
    role,
    quality: images.quality,
  });

  const seo: ImageSeo = {
    alt: clean(input.seo.alt, SEO_LIMITS.alt),
    title: clean(input.seo.title, SEO_LIMITS.title),
    caption: clean(input.seo.caption, SEO_LIMITS.caption),
  };
  const fileName = imageFileName(input.filename, seo.alt || post.title || brief.topic);
  const media = await wp.uploadMedia({
    data: processed.data,
    filename: fileName,
    mimeType: processed.mimeType,
    alt: seo.alt,
    caption: seo.caption,
    title: seo.title || undefined,
  });

  const report = parseImageReport(brief.imageReport);
  let slotId = 'cover';
  if (input.target.kind === 'cover') {
    await wp.updatePost(postId, { featuredMediaId: media.id });
  } else {
    const swapped = replaceImageBlock(post.contentRaw, input.target.mediaId, {
      url: media.sourceUrl,
      alt: seo.alt,
      caption: seo.caption || undefined,
      mediaId: media.id,
    });
    // a imagem sumiu entre a checagem e agora (edição simultânea no WordPress): não sobrescreve
    if (!swapped.replaced) throw new UserFacingError('Essa imagem não está mais no post. Nada foi alterado.', 'gone');
    await wp.updatePost(postId, { content: swapped.html });
    const old = report.images.find((i) => i.role === 'inline' && i.mediaId === (input.target as { mediaId: number }).mediaId);
    slotId = old?.slotId ?? `inline-u${media.id}`;
  }

  const item: ImageReportItem = {
    slotId,
    role,
    origin: 'upload',
    mediaId: media.id,
    url: media.sourceUrl,
    alt: seo.alt,
    caption: seo.caption || undefined,
    width: processed.width,
    height: processed.height,
  };
  await getTenantDb(workspaceId)
    .update(briefs)
    .set({ imageReport: withReplacedImage(report, item), updatedAt: new Date() })
    .where(and(eq(briefs.id, briefId), eq(briefs.workspaceId, workspaceId)));

  return {
    mediaId: media.id,
    url: media.sourceUrl,
    width: processed.width,
    height: processed.height,
    sourceBytes: processed.sourceBytes,
    sourceWidth: processed.sourceWidth,
    sourceHeight: processed.sourceHeight,
    bytes: processed.data.byteLength,
    upscaled: processed.upscaled,
    fileName,
  };
}

/** Ajusta só o SEO (alt, título, legenda) de uma imagem que já está no artigo, sem trocar o arquivo. */
export async function updateBriefImageSeo(
  workspaceId: string,
  briefId: string,
  input: { target: ImageTarget; seo: ImageSeo },
  deps: EditDeps = {},
): Promise<void> {
  const { brief, wp, post, postId } = await load(workspaceId, briefId, deps, input.target.kind === 'inline');
  const seo: ImageSeo = {
    alt: clean(input.seo.alt, SEO_LIMITS.alt),
    title: clean(input.seo.title, SEO_LIMITS.title),
    caption: clean(input.seo.caption, SEO_LIMITS.caption),
  };
  const report = parseImageReport(brief.imageReport);

  let mediaId: number;
  if (input.target.kind === 'inline') {
    mediaId = input.target.mediaId;
    const updated = updateImageBlockSeo(post.contentRaw, mediaId, { alt: seo.alt, caption: seo.caption });
    if (!updated.replaced) throw new UserFacingError('Essa imagem não está mais no post (foi removida ou trocada no WordPress). Nada foi alterado.', 'gone');
    await wp.updatePost(postId, { content: updated.html });
  } else {
    // a capa não tem bloco no texto: o que vale é o anexo que o WordPress diz ser a imagem destacada
    mediaId = post.featuredMediaId ?? report.images.find((i) => i.role === 'cover')?.mediaId ?? 0;
    if (!mediaId) throw new UserFacingError('Este artigo não tem capa para ajustar.');
  }
  await wp.updateMedia(mediaId, { alt: seo.alt, caption: seo.caption, title: seo.title });

  const current = report.images.find((i) => i.mediaId === mediaId);
  if (current) {
    await getTenantDb(workspaceId)
      .update(briefs)
      .set({ imageReport: withReplacedImage(report, { ...current, alt: seo.alt, caption: seo.caption || undefined }), updatedAt: new Date() })
      .where(and(eq(briefs.id, briefId), eq(briefs.workspaceId, workspaceId)));
  }
}

/** Uma edição de texto como o navegador a envia. */
export interface TextEditInput {
  index: number;
  beforeText: string;
  afterHtml: string;
}

export const MAX_TITLE_LENGTH = 200;

/**
 * Ajustes básicos no texto: trechos de parágrafo, título de seção e item de lista, e o título do artigo.
 * Se o WordPress mudou algum trecho depois que o usuário abriu a tela, NADA é gravado.
 */
export async function saveBriefText(
  workspaceId: string,
  briefId: string,
  input: { title?: string; edits: TextEditInput[] },
  deps: EditDeps = {},
): Promise<{ changed: number; titleChanged: boolean }> {
  const { wp, post, postId } = await load(workspaceId, briefId, deps, true);

  // Quem diz se um trecho aceita quebra de linha é o HTML do WordPress, não o navegador.
  const tagOf = new Map(findEditableTexts(post.contentRaw).map((t) => [t.index, t.tag]));
  const edits: TextEdit[] = input.edits.map((e) => ({
    index: e.index,
    beforeText: e.beforeText,
    afterHtml: sanitizeInlineHtml(e.afterHtml, { allowBreaks: tagOf.get(e.index) === 'p' }),
  }));
  const applied = applyTextEdits(post.contentRaw, edits);
  if (!applied.ok) {
    if (applied.reason === 'empty') throw new UserFacingError('Um dos trechos ficou vazio. Apague o parágrafo no WordPress se quiser removê-lo.', 'empty');
    throw new UserFacingError('O texto mudou no WordPress depois que você abriu esta tela. Recarregue a página para ver a versão atual e refaça a edição. Nada foi gravado.', 'conflict');
  }

  const newTitle = input.title === undefined ? undefined : input.title.replace(/\s+/g, ' ').trim();
  if (newTitle !== undefined && (newTitle.length < 3 || newTitle.length > MAX_TITLE_LENGTH)) {
    throw new UserFacingError(`O título precisa ter entre 3 e ${MAX_TITLE_LENGTH} caracteres.`);
  }
  const titleChanged = newTitle !== undefined && newTitle !== post.title.trim();

  if (applied.changed === 0 && !titleChanged) return { changed: 0, titleChanged: false };
  await wp.updatePost(postId, {
    ...(applied.changed > 0 ? { content: applied.html } : {}),
    ...(titleChanged ? { title: newTitle } : {}),
  });
  return { changed: applied.changed, titleChanged };
}

// ---------- imagem da web (arrastada de outra aba ou colada por URL) ----------

/**
 * Baixa uma imagem da web para o servidor processar. Sem seguir redirecionamento e sem rede
 * interna (`publicFetch`), com limite de tamanho: o endereço vem do navegador do usuário, então
 * é tratado como entrada não confiável.
 */
export async function downloadRemoteImage(rawUrl: string): Promise<Uint8Array> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UserFacingError('O endereço da imagem não é válido.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new UserFacingError('Só endereços http(s) são aceitos.');

  let res: Response;
  try {
    res = await publicFetch(url.toString(), {
      headers: { Accept: 'image/*', 'User-Agent': 'ContentPilotBot/1.0' },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new UserFacingError('Não consegui baixar a imagem desse endereço (site fora do ar, redirecionamento ou endereço bloqueado). Baixe o arquivo e envie do computador.');
  }
  if (!res.ok) throw new UserFacingError(`O site da imagem respondeu ${res.status}. Baixe o arquivo e envie do computador.`);
  const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (!type.startsWith('image/')) {
    await res.body?.cancel();
    throw new UserFacingError('Esse endereço não é uma imagem.');
  }
  if (Number(res.headers.get('content-length')) > MAX_UPLOAD_BYTES) {
    await res.body?.cancel();
    throw new UserFacingError('A imagem é grande demais.', 'too_large');
  }
  const reader = res.body?.getReader();
  if (!reader) throw new UserFacingError('Não consegui ler a imagem.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_UPLOAD_BYTES) {
      await reader.cancel();
      throw new UserFacingError('A imagem é grande demais.', 'too_large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
