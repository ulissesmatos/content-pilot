import type { StylePolicy } from '../text/style-guard';

/**
 * Padrões efetivos do template e presets de tamanho de imagem.
 *
 * Sem dependências (nem zod): o editor de templates roda no navegador e precisa dos
 * MESMOS padrões que o worker aplica quando o template não define o campo. Uma cópia
 * dos padrões na tela acabaria diferente do que o worker faz.
 */

export interface ImageSizeValue {
  width: number;
  height: number;
}

export interface ImageSizePreset extends ImageSizeValue {
  id: string;
  label: string;
  /** Para que serve, em uma frase. */
  hint: string;
}

/** Tamanhos prontos para capa e imagens do corpo. */
export const IMAGE_SIZE_PRESETS: readonly ImageSizePreset[] = [
  { id: '1280x720', width: 1280, height: 720, label: '1280 × 720', hint: 'Paisagem 16:9, o padrão de blog' },
  { id: '1920x1080', width: 1920, height: 1080, label: '1920 × 1080', hint: 'Full HD, para temas com capa grande' },
  { id: '1200x630', width: 1200, height: 630, label: '1200 × 630', hint: 'Boa para compartilhar em redes sociais' },
  { id: '700x300', width: 700, height: 300, label: '700 × 300', hint: 'Faixa larga e baixa, estilo banner' },
] as const;

/** Limites que o schema do template aceita; a tela usa os mesmos. */
export const IMAGE_SIZE_LIMITS = { minWidth: 200, maxWidth: 3840, minHeight: 100, maxHeight: 2160 } as const;

export function presetIdOf(size: ImageSizeValue): string {
  return IMAGE_SIZE_PRESETS.find((p) => p.width === size.width && p.height === size.height)?.id ?? 'custom';
}

/** Padrões do bloco `images` quando o template não o define (espelham o schema). */
export const IMAGE_DEFAULTS = {
  enabled: false,
  candidates: 5,
  inlineMax: 3,
  webSearch: true,
  sourceImages: true,
  cover: { width: 1280, height: 720 },
  inline: { width: 1280, height: 720 },
  format: 'webp' as 'webp' | 'original',
  quality: 82,
};

export interface EmbedPolicy {
  video: boolean;
  maxTweets: number;
}

/** Template de dados estruturados (códigos, cupons): texto curto em volta de um widget. */
export const isStructuredTemplate = (cfg: { extraction?: { enabled?: boolean } }): boolean => cfg.extraction?.enabled === true;

export function stylePolicyOf(structured: boolean, style?: { noDashes?: boolean; datePolicy?: 'avoid' | 'allow' }): StylePolicy {
  return {
    noDashes: style?.noDashes ?? true,
    // template que extrai dados verbatim (códigos, cupons...) usa data no título de propósito
    datePolicy: style?.datePolicy ?? (structured ? 'allow' : 'avoid'),
  };
}

export function embedPolicyOf(structured: boolean, embeds?: { video?: boolean; maxTweets?: number }): EmbedPolicy {
  return {
    video: embeds?.video ?? !structured,
    maxTweets: embeds?.maxTweets ?? (structured ? 0 : 2),
  };
}

export function reviewEnabledOf(structured: boolean, review?: { enabled?: boolean }): boolean {
  return review?.enabled ?? !structured;
}

/**
 * Frases curtas do que o template faz, para mostrar no formulário de geração: quem
 * escolhe um template precisa saber, sem abrir o editor, se ele revisa, ilustra e
 * incorpora vídeo. Recebe o config já parseado ou o cru; o que faltar vale o padrão.
 */
export function summarizeTemplate(cfg: {
  extraction?: { enabled?: boolean };
  images?: Partial<typeof IMAGE_DEFAULTS>;
  style?: { noDashes?: boolean; datePolicy?: 'avoid' | 'allow' };
  embeds?: { video?: boolean; maxTweets?: number };
  review?: { enabled?: boolean };
}): string[] {
  const structured = isStructuredTemplate(cfg);
  const out: string[] = [];

  if (reviewEnabledOf(structured, cfg.review)) out.push('Revisão editorial');

  const img = { ...IMAGE_DEFAULTS, ...cfg.images };
  if (img.enabled) {
    const cover = img.cover ?? IMAGE_DEFAULTS.cover;
    out.push(`Capa ${cover.width}×${cover.height}`);
    out.push(img.inlineMax > 0 ? `até ${img.inlineMax} ${img.inlineMax === 1 ? 'imagem' : 'imagens'} no texto` : 'só a capa');
    if (img.format === 'webp') out.push('WebP');
  } else {
    out.push('sem imagens');
  }

  const embeds = embedPolicyOf(structured, cfg.embeds);
  const parts = [embeds.video ? 'vídeo' : '', embeds.maxTweets > 0 ? `${embeds.maxTweets} ${embeds.maxTweets === 1 ? 'tweet' : 'tweets'}` : ''].filter(Boolean);
  if (parts.length) out.push(parts.join(' + '));

  const style = stylePolicyOf(structured, cfg.style);
  if (style.noDashes) out.push('sem travessão');
  if (style.datePolicy === 'avoid') out.push('sem data no título');
  return out;
}
