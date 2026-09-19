import { publicFetch } from '@content-pilot/core';
import {
  combineImageClients,
  illustrate,
  OpenverseClient,
  slugify,
  WebImageSearchClient,
  type ChosenImage,
  type CmsAdapter,
  type ImageSearchClient,
  type InlineImage,
  type LlmCallRecord,
  type LlmProvider,
  type SearchClient,
} from '@content-pilot/core';

/**
 * Ilustra um post: busca imagens (web via Tavily + Openverse), um LLM com visão
 * escolhe a capa e as imagens do corpo (ou nenhuma), baixa e faz upload na
 * mídia do WordPress. Retorna o ID da capa (imagem destacada) e as imagens do
 * corpo já com URL pública do WP — ou vazio se nada serviu (o post é publicado
 * sem imagem; nunca uma imagem errada). Se o download da capa falhar, a melhor
 * imagem do corpo é promovida a capa (capa tem prioridade).
 */
export async function illustratePost(opts: {
  wp: CmsAdapter;
  llmVision: LlmProvider;
  topic: string;
  keywords: string[];
  language: string;
  candidates: number;
  /** Quantas imagens para o corpo do texto (0 = só capa). */
  inlineCount?: number;
  /** Cliente de busca (Tavily) para imagens da web — mais relevantes que só o acervo aberto. */
  search?: SearchClient;
  /** Desliga a busca de imagens na web (fica só o Openverse). */
  webSearch?: boolean;
  checkBudget?: () => Promise<void> | void;
  log?: (msg: string) => void;
}): Promise<{ mediaId: number | null; inlineImages: InlineImage[]; llmCalls: LlmCallRecord[] }> {
  const log = opts.log ?? (() => {});

  // web primeiro (relevância), Openverse como reforço (licença aberta garantida)
  const providers: ImageSearchClient[] = [];
  if (opts.webSearch !== false && opts.search?.searchImages) providers.push(new WebImageSearchClient(opts.search));
  providers.push(new OpenverseClient());

  const ill = await illustrate(
    {
      topic: opts.topic,
      keywords: opts.keywords,
      language: opts.language,
      maxCandidates: opts.candidates,
      inlineCount: opts.inlineCount ?? 0,
    },
    {
      images: combineImageClients(providers),
      llmVision: opts.llmVision,
      checkBudget: opts.checkBudget,
      log,
    },
  );

  if (ill.status !== 'ok') {
    log(`ilustração: sem imagem (${ill.status})`);
    return { mediaId: null, inlineImages: [], llmCalls: ill.llmCalls };
  }

  const inlineQueue = [...ill.inline];

  // Capa: tenta a escolhida; se o download/upload falhar, promove a próxima do corpo.
  let mediaId: number | null = null;
  let cover = ill.cover;
  while (cover) {
    const media = await uploadImage(opts.wp, cover, opts.topic, log);
    if (media) {
      mediaId = media.id;
      break;
    }
    log('ilustração: capa falhou — promovendo a próxima imagem do corpo a capa');
    cover = inlineQueue.shift() ?? null;
  }

  // Imagens do corpo: falha individual só pula a imagem.
  const inlineImages: InlineImage[] = [];
  for (const img of inlineQueue) {
    const media = await uploadImage(opts.wp, img, opts.topic, log);
    if (media) inlineImages.push({ url: media.sourceUrl, alt: img.alt, caption: img.attribution || undefined });
  }

  if (mediaId) log(`ilustração: capa enviada ao WP (media #${mediaId})`);
  if (inlineImages.length) log(`ilustração: ${inlineImages.length} imagem(ns) do corpo enviadas ao WP`);
  return { mediaId, inlineImages, llmCalls: ill.llmCalls };
}

async function uploadImage(
  wp: CmsAdapter,
  img: ChosenImage,
  topic: string,
  log: (msg: string) => void,
): Promise<{ id: number; sourceUrl: string } | null> {
  const downloaded = await downloadImage(img.url);
  if (!downloaded) {
    log(`ilustração: download falhou (${img.url.slice(0, 80)})`);
    return null;
  }
  try {
    return await wp.uploadMedia({
      data: downloaded.data,
      filename: `${slugify(topic, { maxLength: 60, fallback: 'imagem' })}.${extFor(downloaded.mimeType)}`,
      mimeType: downloaded.mimeType,
      alt: img.alt,
      caption: img.attribution || undefined,
    });
  } catch (err) {
    log(`ilustração: upload falhou (${err instanceof Error ? err.message : String(err)})`);
    return null;
  }
}

async function downloadImage(url: string): Promise<{ data: Uint8Array; mimeType: string } | null> {
  try {
    const res = await publicFetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const mimeType = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0]!.trim();
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mimeType)) {
      await res.body?.cancel();
      return null;
    }
    if (Number(res.headers.get('content-length')) > 8_000_000) {
      await res.body?.cancel();
      return null;
    }
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8_000_000) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    // sanidade: 5KB..8MB (evita ícones minúsculos e arquivos gigantes — capa precisa de resolução)
    if (data.byteLength < 5_000 || data.byteLength > 8_000_000) return null;
    return { data, mimeType };
  } catch {
    return null;
  }
}

function extFor(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };
  return map[mimeType] ?? 'jpg';
}
