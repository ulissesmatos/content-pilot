import sharp from 'sharp';
import { publicFetch, type ChosenImage, type ImageCandidate, type ImageSize, type PreparedImage } from '@content-pilot/core';

/**
 * Tudo que toca em pixel: baixar, medir, reduzir para a visão e converter para o
 * arquivo final. Fica no worker porque o `sharp` é módulo nativo; o core segue
 * puro e recebe estas funções por injeção.
 */

const MAX_DOWNLOAD_BYTES = 8_000_000;
/** Menor que isto é ícone ou thumbnail: não serve de capa nem de imagem de corpo. */
const MIN_BYTES = 5_000;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
/** Banner ultra-largo ou faixa vertical não vira capa decente. */
const MAX_ASPECT = 3.4;
const MIN_ASPECT = 0.4;
/** Miniatura que vai à visão: legível, mas pequena o bastante para não custar token à toa. */
const VISION_THUMB = 640;

/** Menor lado aceito por papel: a capa precisa de resolução, o corpo tolera menos. */
export const MIN_SIDE = { cover: 600, inline: 400 } as const;

export interface DownloadedImage {
  data: Uint8Array;
  mimeType: string;
}

/** Baixa com limite de tamanho, sem seguir redirect e sem rede interna (publicFetch). */
export async function downloadImage(url: string): Promise<DownloadedImage | null> {
  try {
    const res = await publicFetch(url, {
      headers: { Accept: 'image/*', 'User-Agent': 'ContentPilotBot/1.0' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const mimeType = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0]!.trim().toLowerCase();
    if (!ALLOWED_MIME.has(mimeType)) {
      await res.body?.cancel();
      return null;
    }
    if (Number(res.headers.get('content-length')) > MAX_DOWNLOAD_BYTES) {
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
      if (size > MAX_DOWNLOAD_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    if (size < MIN_BYTES) return null;
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { data, mimeType };
  } catch {
    return null;
  }
}

/**
 * Baixa, mede e reduz UMA candidata. `null` descarta: falhou, é pequena demais,
 * é banner, ou o arquivo nem é imagem de verdade (a extensão engana, o `sharp` não).
 *
 * Isto roda ANTES da visão. Antes, as URLs iam direto para o provedor de IA, que
 * é quem baixava, e uma única candidata bloqueada derrubava a chamada inteira.
 */
export async function prepareCandidate(
  candidate: ImageCandidate,
  role: 'cover' | 'inline',
): Promise<PreparedImage | null> {
  const downloaded = await downloadImage(candidate.url);
  if (!downloaded) return null;
  try {
    const image = sharp(downloaded.data, { failOn: 'error' });
    const meta = await image.metadata();
    const { width, height } = meta;
    if (!width || !height) return null;
    if (Math.min(width, height) < MIN_SIDE[role]) return null;
    const aspect = width / height;
    if (aspect > MAX_ASPECT || aspect < MIN_ASPECT) return null;

    const thumb = await image
      .rotate() // respeita a orientação EXIF
      .resize({ width: VISION_THUMB, height: VISION_THUMB, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 72 })
      .toBuffer();
    return {
      candidate,
      thumbnail: `data:image/jpeg;base64,${thumb.toString('base64')}`,
      original: { data: downloaded.data, mimeType: downloaded.mimeType, width, height },
    };
  } catch {
    return null;
  }
}

export interface FinalFile {
  data: Uint8Array;
  mimeType: string;
  extension: string;
  width: number;
  height: number;
}

export interface ProcessOptions {
  size: ImageSize;
  role: 'cover' | 'inline';
  format: 'webp' | 'original';
  quality: number;
  /** Imagem gerada por IA sempre é recortada no tamanho exato: o tamanho foi pedido. */
  generated: boolean;
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * Arquivo final para o WordPress.
 *
 *  - Gerada por IA: recorte exato até `size`. A API só oferece 1536x1024 e afins;
 *    1280x720 sai daí.
 *  - Capa real: recorte com foco no assunto (`attention`), para todas as capas do
 *    blog terem a mesma proporção na listagem.
 *  - Imagem real do corpo: só reduz até caber, sem recortar (cortar uma foto de
 *    terceiro pode tirar exatamente o que ela mostrava) e sem esticar.
 *
 * WebP por padrão. Em qualquer falha do conversor devolve o original: um post
 * com imagem em JPEG é melhor que um post sem imagem.
 */
export async function processForUpload(
  source: { data: Uint8Array; mimeType: string },
  opts: ProcessOptions,
): Promise<FinalFile> {
  const original: FinalFile = {
    data: source.data,
    mimeType: source.mimeType,
    extension: EXT[source.mimeType] ?? 'jpg',
    width: 0,
    height: 0,
  };
  try {
    let pipeline = sharp(source.data).rotate();
    const exact = opts.generated || opts.role === 'cover';
    pipeline = exact
      ? pipeline.resize({ width: opts.size.width, height: opts.size.height, fit: 'cover', position: 'attention' })
      : pipeline.resize({ width: opts.size.width, height: opts.size.height, fit: 'inside', withoutEnlargement: true });

    if (opts.format === 'webp') {
      const out = await pipeline.webp({ quality: opts.quality, effort: 4 }).toBuffer({ resolveWithObject: true });
      return { data: out.data, mimeType: 'image/webp', extension: 'webp', width: out.info.width, height: out.info.height };
    }
    const out = await pipeline.toBuffer({ resolveWithObject: true });
    return { ...original, data: out.data, width: out.info.width, height: out.info.height };
  } catch {
    return original;
  }
}

/** Nome de arquivo estável e legível: aparece na biblioteca de mídia do WordPress. */
export function imageFilename(base: string, extension: string): string {
  return `${base}.${extension}`;
}

export type { ChosenImage };
