import type { ImageSize } from './generate';

/**
 * Tudo que transforma pixel para o WordPress: recorte, redução e conversão para WebP.
 *
 * Usado pelo worker (imagens escolhidas e geradas) e pelo painel (imagens que o usuário envia).
 * O `sharp` é módulo nativo, então é carregado sob demanda: quem só importa o core para outra
 * coisa não paga o carregamento, e o bundle do navegador nunca o enxerga.
 */

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

async function loadSharp() {
  return (await import('sharp')).default;
}

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
    const sharp = await loadSharp();
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

// ---------- imagem enviada pelo usuário ----------

/** Maior arquivo aceito do usuário. */
export const MAX_UPLOAD_BYTES = 15_000_000;
/** Maior imagem em pixels (largura x altura): protege contra "bomba" de descompressão. */
const MAX_INPUT_PIXELS = 80_000_000;
/** Menor lado aceito: abaixo disto nem serve de miniatura. */
const MIN_UPLOAD_SIDE = 100;
/** Formatos aceitos. SVG fica de fora de propósito: pode carregar script e referências externas. */
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'tiff', 'heif']);

export type ImageUploadErrorCode = 'too_large' | 'invalid' | 'unsupported' | 'too_small';

/** O arquivo enviado não serve; a mensagem é escrita para o usuário. */
export class ImageUploadError extends Error {
  constructor(
    message: string,
    readonly code: ImageUploadErrorCode,
  ) {
    super(message);
    this.name = 'ImageUploadError';
  }
}

export interface UploadedImageResult extends FinalFile {
  sourceWidth: number;
  sourceHeight: number;
  sourceBytes: number;
  /** A capa foi ampliada para caber no tamanho exato (a imagem original era menor): pode ficar borrada. */
  upscaled: boolean;
}

/**
 * Imagem que o usuário enviou (arquivo, colagem ou arrastada da web) até o arquivo final.
 * SEMPRE WebP, seja qual for o formato de entrada: o que entra na biblioteca do WordPress é
 * leve. Capa é recortada no tamanho exato do template; imagem do texto só é reduzida.
 */
export async function processUploadedImage(
  data: Uint8Array,
  opts: { size: ImageSize; role: 'cover' | 'inline'; quality: number },
): Promise<UploadedImageResult> {
  if (data.byteLength === 0) throw new ImageUploadError('O arquivo está vazio.', 'invalid');
  if (data.byteLength > MAX_UPLOAD_BYTES) {
    throw new ImageUploadError(`A imagem tem ${(data.byteLength / 1_000_000).toFixed(1)} MB; o limite é ${MAX_UPLOAD_BYTES / 1_000_000} MB.`, 'too_large');
  }

  const sharp = await loadSharp();
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try {
    meta = await sharp(data, { limitInputPixels: MAX_INPUT_PIXELS, animated: false }).metadata();
  } catch {
    throw new ImageUploadError('Esse arquivo não parece uma imagem válida (ou é grande demais em pixels).', 'invalid');
  }
  if (!meta.format || !ACCEPTED_FORMATS.has(meta.format)) {
    throw new ImageUploadError('Formato não aceito. Use JPEG, PNG, WebP, GIF ou AVIF.', 'unsupported');
  }
  // metadata() devolve as dimensões antes de girar; com orientação EXIF de retrato os lados trocam
  const sourceWidth = meta.autoOrient?.width ?? meta.width ?? 0;
  const sourceHeight = meta.autoOrient?.height ?? meta.height ?? 0;
  if (Math.min(sourceWidth, sourceHeight) < MIN_UPLOAD_SIDE) {
    throw new ImageUploadError(`A imagem é pequena demais (${sourceWidth}×${sourceHeight}). Use uma com pelo menos ${MIN_UPLOAD_SIDE} px de lado.`, 'too_small');
  }

  const exact = opts.role === 'cover';
  let pipeline = sharp(data, { limitInputPixels: MAX_INPUT_PIXELS, animated: false }).rotate();
  pipeline = exact
    ? pipeline.resize({ width: opts.size.width, height: opts.size.height, fit: 'cover', position: 'attention' })
    : pipeline.resize({ width: opts.size.width, height: opts.size.height, fit: 'inside', withoutEnlargement: true });

  let out: { data: Buffer; info: { width: number; height: number } };
  try {
    out = await pipeline.webp({ quality: opts.quality, effort: 4 }).toBuffer({ resolveWithObject: true });
  } catch {
    throw new ImageUploadError('Não consegui converter essa imagem para WebP.', 'invalid');
  }

  return {
    data: new Uint8Array(out.data),
    mimeType: 'image/webp',
    extension: 'webp',
    width: out.info.width,
    height: out.info.height,
    sourceWidth,
    sourceHeight,
    sourceBytes: data.byteLength,
    upscaled: exact && (sourceWidth < opts.size.width || sourceHeight < opts.size.height),
  };
}
