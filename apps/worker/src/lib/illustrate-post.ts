import {
  combineImageClients,
  fetchSourceImages,
  illustrateArticle,
  OpenverseClient,
  publicFetch,
  slugify,
  WebImageSearchClient,
  type ChosenImage,
  type CmsAdapter,
  type ImageGenClient,
  type ImageReport,
  type ImageReportItem,
  type ImageSearchClient,
  type ImageSize,
  type InlineImage,
  type LlmCallRecord,
  type LlmProvider,
  type SearchClient,
  type SlotHint,
} from '@content-pilot/core';
import { imageFilename, prepareCandidate, processForUpload } from './image-processing';

/** Imagem do corpo já no WordPress, com o parágrafo depois do qual entra. */
export interface UploadedInline {
  /** Parágrafo planejado para o slot: `injectAfterParagraphs` a põe ali, falhe outro slot ou não. */
  afterParagraph: number;
  image: InlineImage;
}

export interface IllustratePostResult {
  /** ID da imagem destacada. Null quando nada produziu capa. */
  mediaId: number | null;
  /** Imagens do corpo, cada uma com o parágrafo do próprio slot. */
  inline: UploadedInline[];
  /** Quantos slots do corpo foram planejados. */
  plannedInline: number;
  /** Nenhuma capa: o post NÃO deve ser publicado. */
  coverMissing: boolean;
  llmCalls: LlmCallRecord[];
  /** Uma linha por slot: de onde veio a imagem, ou por que não veio. */
  notes: string[];
  /** O que entrou de imagem e de onde veio; gravado na pauta para a tela de preview. */
  report: ImageReport;
}

/**
 * Ilustra um post: cada imagem (capa e corpo) é um slot com busca própria,
 * escolha pela visão e, se nada serve, geração por IA no tamanho do slot. O que
 * sai vai para o WordPress convertido em WebP, no tamanho configurado.
 *
 * A capa é obrigatória: se nenhum meio a produzir, `coverMissing` avisa o
 * chamador para não publicar. Falha em imagem do corpo só pula aquela imagem.
 */
export async function illustratePost(opts: {
  wp: CmsAdapter;
  llmVision: LlmProvider;
  topic: string;
  keywords: string[];
  language: string;
  /** HTML final do artigo: dele saem as posições e o contexto de cada imagem. */
  html: string;
  /** Dicas do revisor editorial sobre onde uma imagem ajuda e o que ela deve mostrar. */
  hints?: SlotHint[];
  candidates: number;
  inlineCount: number;
  coverSize: ImageSize;
  inlineSize: ImageSize;
  format: 'webp' | 'original';
  quality: number;
  /** URLs das fontes do artigo: dali vem a imagem de destaque de cada matéria. */
  sourceUrls?: string[];
  /** Cliente de busca (Tavily) para imagens da web. */
  search?: SearchClient;
  webSearch?: boolean;
  useSourceImages?: boolean;
  imageGen?: ImageGenClient;
  checkBudget?: () => Promise<void> | void;
  log?: (msg: string) => void;
}): Promise<IllustratePostResult> {
  const log = opts.log ?? (() => {});

  // web primeiro (relevância), Openverse como reforço (licença aberta garantida)
  const providers: ImageSearchClient[] = [];
  if (opts.webSearch !== false && opts.search?.searchImages) providers.push(new WebImageSearchClient(opts.search));
  providers.push(new OpenverseClient());

  const ill = await illustrateArticle(
    {
      topic: opts.topic,
      keywords: opts.keywords,
      language: opts.language,
      html: opts.html,
      hints: opts.hints,
      inlineCount: opts.inlineCount,
      coverSize: opts.coverSize,
      inlineSize: opts.inlineSize,
      maxCandidates: opts.candidates,
    },
    {
      images: combineImageClients(providers),
      sourceImages:
        opts.useSourceImages !== false && opts.sourceUrls?.length
          ? () => fetchSourceImages(opts.sourceUrls!, { fetchImpl: publicFetch })
          : undefined,
      prepare: (candidate, slot) => prepareCandidate(candidate, slot.role),
      llmVision: opts.llmVision,
      imageGen: opts.imageGen,
      checkBudget: opts.checkBudget,
      log,
    },
  );

  const base = slugify(opts.topic, { maxLength: 60, fallback: 'imagem' });
  const items: ImageReportItem[] = [];
  const upload = async (img: ChosenImage, role: 'cover' | 'inline') => {
    const done = await uploadChosen(opts.wp, img, role, base, opts, log);
    if (done) {
      items.push({
        slotId: role === 'cover' ? 'cover' : img.slot.id,
        role,
        origin: img.origin,
        mediaId: done.media.id,
        url: done.media.sourceUrl,
        alt: img.alt,
        caption: img.caption || undefined,
        width: done.width || undefined,
        height: done.height || undefined,
        sourcePage: img.sourcePage || undefined,
      });
    }
    return done?.media ?? null;
  };

  // Capa: tenta a escolhida; se o envio falhar, promove a próxima imagem do corpo.
  let mediaId: number | null = null;
  const inlineQueue = [...ill.inline];
  let cover = ill.cover;
  while (cover) {
    const media = await upload(cover, 'cover');
    if (media) {
      mediaId = media.id;
      break;
    }
    log('ilustração: envio da capa falhou, promovendo a próxima imagem do corpo a capa');
    cover = inlineQueue.shift() ?? null;
  }

  // Imagens do corpo: falha individual só pula a imagem, e as demais mantêm o ponto do próprio slot.
  const inline: UploadedInline[] = [];
  for (const img of inlineQueue) {
    const media = await upload(img, 'inline');
    if (media && img.slot.afterParagraph !== undefined) {
      inline.push({
        afterParagraph: img.slot.afterParagraph,
        image: { url: media.sourceUrl, alt: img.alt, caption: img.caption || undefined, mediaId: media.id },
      });
    }
  }

  const coverMissing = mediaId === null;
  if (mediaId) log(`ilustração: capa enviada ao WP (media #${mediaId})`);
  if (inline.length) log(`ilustração: ${inline.length} imagem(ns) do corpo enviadas ao WP`);
  if (coverMissing) log('ilustração: o post ficou SEM capa');
  return {
    mediaId,
    inline,
    plannedInline: ill.plannedInline,
    coverMissing,
    llmCalls: ill.llmCalls,
    notes: ill.notes,
    report: { coverMissing, plannedInline: ill.plannedInline, images: items, notes: ill.notes },
  };
}

async function uploadChosen(
  wp: CmsAdapter,
  img: ChosenImage,
  role: 'cover' | 'inline',
  base: string,
  cfg: { format: 'webp' | 'original'; quality: number; coverSize: ImageSize; inlineSize: ImageSize },
  log: (msg: string) => void,
): Promise<{ media: { id: number; sourceUrl: string }; width: number; height: number } | null> {
  const file = await processForUpload(
    { data: img.original.data, mimeType: img.original.mimeType },
    {
      size: role === 'cover' ? cfg.coverSize : cfg.inlineSize,
      role,
      format: cfg.format,
      quality: cfg.quality,
      generated: img.origin === 'generated',
    },
  );
  const suffix = role === 'cover' ? 'capa' : img.slot.id.replace('inline-', '');
  try {
    const media = await wp.uploadMedia({
      data: file.data,
      filename: imageFilename(`${base}-${suffix}`, file.extension),
      mimeType: file.mimeType,
      alt: img.alt,
      caption: img.caption || undefined,
    });
    log(
      `ilustração [${img.slot.id}]: ${file.extension.toUpperCase()} ${file.width || '?'}x${file.height || '?'} ` +
        `(${(file.data.byteLength / 1024).toFixed(0)} KB, ${img.origin === 'generated' ? 'gerada por IA' : 'imagem real'})`,
    );
    return { media, width: file.width, height: file.height };
  } catch (err) {
    log(`ilustração [${img.slot.id}]: upload falhou (${err instanceof Error ? err.message : String(err)})`);
    return null;
  }
}
