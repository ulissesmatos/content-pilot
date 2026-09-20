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

// A conversão para o arquivo final é a mesma que o painel usa para imagens enviadas pelo usuário.
export { imageFilename, processForUpload, type FinalFile, type ProcessOptions } from '@content-pilot/core';

export type { ChosenImage };
