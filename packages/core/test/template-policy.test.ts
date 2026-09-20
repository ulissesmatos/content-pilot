import { describe, expect, it } from 'vitest';
import {
  IMAGE_DEFAULTS,
  IMAGE_SIZE_LIMITS,
  IMAGE_SIZE_PRESETS,
  embedPolicyOf,
  gameCodesTemplate,
  genericArticleTemplate,
  imageSizeSchema,
  isReviewEnabled,
  parseTemplateConfig,
  presetIdOf,
  resolveEmbedPolicy,
  resolveStylePolicy,
  reviewEnabledOf,
  stylePolicyOf,
  summarizeTemplate,
  templateConfigSchema,
} from '../src';

describe('padrões efetivos do template', () => {
  it('a tela e o worker leem o MESMO padrão: os resolvers do schema devolvem o que as funções puras devolvem', () => {
    for (const seed of [genericArticleTemplate, gameCodesTemplate]) {
      const cfg = parseTemplateConfig(seed.config);
      const structured = cfg.extraction.enabled;
      expect(resolveStylePolicy(cfg)).toEqual(stylePolicyOf(structured, cfg.style));
      expect(resolveEmbedPolicy(cfg)).toEqual(embedPolicyOf(structured, cfg.embeds));
      expect(isReviewEnabled(cfg)).toBe(reviewEnabledOf(structured, cfg.review));
    }
  });

  it('artigo: revisa, tem vídeo e 2 tweets, sem travessão nem data. Dados estruturados: nada disso, e data no título é permitida', () => {
    expect(stylePolicyOf(false)).toEqual({ noDashes: true, datePolicy: 'avoid' });
    expect(embedPolicyOf(false)).toEqual({ video: true, maxTweets: 2 });
    expect(reviewEnabledOf(false)).toBe(true);

    expect(stylePolicyOf(true)).toEqual({ noDashes: true, datePolicy: 'allow' });
    expect(embedPolicyOf(true)).toEqual({ video: false, maxTweets: 0 });
    expect(reviewEnabledOf(true)).toBe(false);
  });

  it('o que o template define explicitamente vence o padrão', () => {
    expect(stylePolicyOf(true, { datePolicy: 'avoid', noDashes: false })).toEqual({ noDashes: false, datePolicy: 'avoid' });
    expect(embedPolicyOf(false, { video: false, maxTweets: 0 })).toEqual({ video: false, maxTweets: 0 });
    expect(reviewEnabledOf(false, { enabled: false })).toBe(false);
    expect(reviewEnabledOf(true, { enabled: true })).toBe(true);
  });

  it('os padrões de imagem da tela espelham os do schema', () => {
    const parsed = templateConfigSchema.parse({
      ...genericArticleTemplate.config,
      images: undefined,
    }).images;
    expect(parsed).toEqual(IMAGE_DEFAULTS);
  });
});

describe('presets de tamanho de imagem', () => {
  it('todo preset é aceito pelo schema, e os pedidos pelo usuário estão na lista', () => {
    for (const p of IMAGE_SIZE_PRESETS) {
      expect(imageSizeSchema.safeParse({ width: p.width, height: p.height }).success, p.id).toBe(true);
    }
    const ids = IMAGE_SIZE_PRESETS.map((p) => p.id);
    for (const wanted of ['1280x720', '700x300', '1920x1080']) expect(ids).toContain(wanted);
  });

  it('os limites da tela são os do schema', () => {
    const { minWidth, maxWidth, minHeight, maxHeight } = IMAGE_SIZE_LIMITS;
    expect(imageSizeSchema.safeParse({ width: minWidth, height: minHeight }).success).toBe(true);
    expect(imageSizeSchema.safeParse({ width: maxWidth, height: maxHeight }).success).toBe(true);
    expect(imageSizeSchema.safeParse({ width: minWidth - 1, height: minHeight }).success).toBe(false);
    expect(imageSizeSchema.safeParse({ width: maxWidth + 1, height: maxHeight }).success).toBe(false);
    expect(imageSizeSchema.safeParse({ width: maxWidth, height: minHeight - 1 }).success).toBe(false);
    expect(imageSizeSchema.safeParse({ width: maxWidth, height: maxHeight + 1 }).success).toBe(false);
  });

  it('presetIdOf reconhece o preset e cai em "custom" para qualquer outro tamanho', () => {
    expect(presetIdOf({ width: 700, height: 300 })).toBe('700x300');
    expect(presetIdOf({ width: 1000, height: 500 })).toBe('custom');
  });
});

describe('summarizeTemplate', () => {
  it('artigo genérico: o resumo diz o que o template faz', () => {
    const chips = summarizeTemplate(parseTemplateConfig(genericArticleTemplate.config));
    expect(chips).toEqual(
      expect.arrayContaining(['Revisão editorial', 'Capa 1280×720', 'até 3 imagens no texto', 'WebP', 'vídeo + 2 tweets', 'sem travessão', 'sem data no título']),
    );
  });

  it('dados estruturados: sem revisão, sem embeds, data permitida', () => {
    const chips = summarizeTemplate(parseTemplateConfig(gameCodesTemplate.config));
    expect(chips).not.toContain('Revisão editorial');
    expect(chips).not.toContain('sem data no título');
    expect(chips.join(' ')).not.toMatch(/vídeo|tweet/);
  });

  it('sem imagens, só capa, singular e config cru (sem blocos) usam os padrões', () => {
    expect(summarizeTemplate({})).toContain('sem imagens');
    expect(summarizeTemplate({ images: { enabled: true, inlineMax: 0 } })).toContain('só a capa');
    expect(summarizeTemplate({ images: { enabled: true, inlineMax: 1 } })).toContain('até 1 imagem no texto');
    expect(summarizeTemplate({ embeds: { video: false, maxTweets: 1 } })).toContain('1 tweet');
    expect(summarizeTemplate({ images: { enabled: true, cover: { width: 700, height: 300 } } })).toContain('Capa 700×300');
  });
});
