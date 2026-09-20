import { z } from 'zod';
import type { JsonSchema } from '../llm/types';

/**
 * Schema do `config` JSONB de content_templates. Tudo que era hardcoded no
 * workflow n8n (queries, block/trust lists, prompts, schema de extração,
 * widget) vira configuração aqui.
 */

export const templateQuerySchema = z.object({
  name: z.string().min(1),
  /** Locale usado para formatar {{monthYear}}/{{prevMonthYear}} desta query. */
  locale: z.string().min(2),
  template: z.string().min(3),
});

/**
 * Tamanho em pixels. Limites existem porque o valor vira o tamanho da imagem
 * gerada e paga pelo usuário, e porque acima disso o WordPress só reduz.
 */
export const imageSizeSchema = z.object({
  width: z.number().int().min(200).max(3840),
  height: z.number().int().min(100).max(2160),
});

export const templatePromptsSchema = z.object({
  /** Prompt de atualização de post existente. */
  update: z.string().min(10),
  /** Prompt de geração de post novo (pautas). */
  generate: z.string().min(10).optional(),
  /** Prompt de verificação dos dados extraídos (2ª chamada, temp 0). */
  verify: z.string().min(10).optional(),
});

export const templateConfigSchema = z.object({
  defaultLanguage: z.string().default('pt-BR'),
  topic: z
    .object({
      /** Regexes (gi) removidas do título ao derivar o tópico (ex.: "códigos?"). */
      stripPatterns: z.array(z.string()).default([]),
      /** O título é cortado no primeiro destes separadores. */
      cutAt: z.array(z.string()).default(['(', ':', '-']),
    })
    .default({ stripPatterns: [], cutAt: ['(', ':', '-'] }),
  queries: z.array(templateQuerySchema).min(1),
  sources: z.object({
    blocklist: z.array(z.string()).default([]),
    trustlist: z.array(z.string()).default([]),
    sourceLimit: z.number().int().positive().default(20),
    perQueryQuota: z.number().int().positive().default(6),
    perSourceCharLimit: z.number().int().positive().default(30_000),
    contextCharLimit: z.number().int().positive().default(180_000),
  }),
  /** Prompts por locale ('pt-BR', 'en-US'...). O idioma do job escolhe; cai no defaultLanguage. */
  prompts: z.record(z.string(), templatePromptsSchema),
  extraction: z.object({
    enabled: z.boolean().default(false),
    /** JSON Schema das propriedades de `data` na resposta do LLM. */
    dataSchema: z
      .record(z.string(), z.unknown())
      .default({ type: 'object', properties: {}, required: [], additionalProperties: false }),
    /** Listas de `data` cujos valores exigem checagem verbatim contra as fontes. */
    verbatimLists: z
      .array(z.object({ path: z.string(), valueField: z.string() }))
      .default([]),
    valuePattern: z.string().default('^[A-Za-z0-9!?_@#.\\-]{2,40}$'),
    /** noDataFound só é publicável com pelo menos N fontes (evidência mínima). */
    minSourcesForEmptyClaim: z.number().int().default(3),
  }),
  managedBlock: z.object({
    enabled: z.boolean().default(false),
    markerPrefix: z.string().default('CP-BLOCK'),
    rendererId: z.string().default(''),
    legacySignatures: z.array(z.string()).default([]),
  }),
  /** SEO estruturado (Fase 2): meta description e escolha de categoria pelo LLM. */
  seo: z
    .object({
      /** Pede uma meta description ao LLM (vira excerpt no WP). */
      metaDescription: z.boolean().default(false),
      /** Pede ao LLM que escolha a categoria entre as reais do site. */
      chooseCategory: z.boolean().default(false),
    })
    .default({ metaDescription: false, chooseCategory: false }),
  /**
   * Links externos (Fase 2): o prompt pede N links para fontes reais; a
   * validação determinística remove qualquer link cujo href não conste nas
   * fontes da busca (anti-alucinação, igual aos códigos).
   */
  externalLinks: z
    .object({
      enabled: z.boolean().default(false),
      min: z.number().int().default(2),
      max: z.number().int().default(4),
    })
    .default({ enabled: false, min: 2, max: 4 }),
  /**
   * Imagens (Fase 3): busca imagens (web + acervo aberto), um LLM com visão
   * escolhe a capa e as imagens do corpo (ou nenhuma). A capa vira imagem
   * destacada; as do corpo são injetadas entre os parágrafos.
   */
  images: z
    .object({
      enabled: z.boolean().default(false),
      /** Quantas candidatas mostrar ao modelo de visão. */
      candidates: z.number().int().min(1).max(10).default(5),
      /** Máximo de imagens no corpo do texto (0 = só capa). O total real escala com o tamanho do artigo. */
      inlineMax: z.number().int().min(0).max(6).default(3),
      /** Busca imagens na web (Tavily) além do acervo aberto (Openverse) — muito mais relevantes; licença não verificada. */
      webSearch: z.boolean().default(true),
      /** Usa a imagem de destaque (og:image) das fontes que embasam o artigo. */
      sourceImages: z.boolean().default(true),
      /**
       * Tamanho FINAL da capa. Imagem gerada por IA é recortada até este tamanho
       * exato; imagem real é recortada com foco no assunto para a capa não sair
       * com proporção diferente das outras.
       */
      cover: imageSizeSchema.default({ width: 1280, height: 720 }),
      /** Tamanho máximo das imagens do corpo (imagem real só é reduzida, nunca esticada). */
      inline: imageSizeSchema.default({ width: 1280, height: 720 }),
      /** Formato do arquivo enviado ao WordPress. WebP é bem menor para a mesma qualidade. */
      format: z.enum(['webp', 'original']).default('webp'),
      /** Qualidade do WebP (1-100). */
      quality: z.number().int().min(40).max(100).default(82),
    })
    .default({
      enabled: false,
      candidates: 5,
      inlineMax: 3,
      webSearch: true,
      sourceImages: true,
      cover: { width: 1280, height: 720 },
      inline: { width: 1280, height: 720 },
      format: 'webp',
      quality: 82,
    }),
  /**
   * Estilo do texto gerado. Ambos opcionais: quando ausentes valem os padrões de
   * `resolveStylePolicy`, o que permite que templates já gravados no banco (e os
   * clones dos clientes) ganhem a regra sem migração.
   */
  style: z
    .object({
      /** Reescreve travessões no texto gerado. Padrão: ligado. */
      noDashes: z.boolean().optional(),
      /**
       * 'avoid' tira data decorativa do título. Padrão: 'avoid', exceto em
       * template com extração de dados (ex.: códigos de jogos), onde mês/ano no
       * título é convenção do nicho e não ruído.
       */
      datePolicy: z.enum(['avoid', 'allow']).optional(),
    })
    .optional(),
  /**
   * Conteúdo incorporado no artigo: vídeo do YouTube e tweets. Opcional: quando
   * ausente valem os padrões de `resolveEmbedPolicy`.
   */
  embeds: z
    .object({
      video: z.boolean().optional(),
      /** 0 desliga tweets. */
      maxTweets: z.number().int().min(0).max(4).optional(),
    })
    .optional(),
  /**
   * Revisão editorial (etapa separada da redação). Opcional: quando ausente o
   * padrão de `isReviewEnabled` vale, o que dá a revisão a templates já gravados
   * sem migração.
   */
  review: z
    .object({
      enabled: z.boolean().optional(),
    })
    .optional(),
  validation: z
    .object({
      titleMin: z.number().int().default(10),
      titleMax: z.number().int().default(120),
      htmlMinChars: z.number().int().default(200),
    })
    .default({ titleMin: 10, titleMax: 120, htmlMinChars: 200 }),
  llmDefaults: z
    .object({
      generateMaxTokens: z.number().int().default(16_000),
      generateTemperature: z.number().default(0.2),
      verifyMaxTokens: z.number().int().default(8_000),
      verifyTemperature: z.number().default(0),
    })
    .default({ generateMaxTokens: 16_000, generateTemperature: 0.2, verifyMaxTokens: 8_000, verifyTemperature: 0 }),
});

export type TemplateConfig = z.infer<typeof templateConfigSchema>;

/**
 * Que embeds este template incorpora? Padrão: um vídeo e até dois tweets em
 * artigo; nada em template de dados estruturados (o texto em volta do widget é
 * curto e um vídeo ali só polui).
 */
export function resolveEmbedPolicy(cfg: TemplateConfig): { video: boolean; maxTweets: number } {
  const structured = cfg.extraction.enabled;
  return {
    video: cfg.embeds?.video ?? !structured,
    maxTweets: cfg.embeds?.maxTweets ?? (structured ? 0 : 2),
  };
}

/**
 * A revisão editorial roda neste template? Padrão: sim para artigo, não para
 * template com extração de dados (códigos, cupons), onde o texto em volta do
 * widget é curto e estruturado e uma reescrita só arriscaria o dado.
 */
export function isReviewEnabled(cfg: TemplateConfig): boolean {
  return cfg.review?.enabled ?? !cfg.extraction.enabled;
}

/** Política de estilo efetiva do template, com os padrões aplicados. */
export function resolveStylePolicy(cfg: TemplateConfig): { noDashes: boolean; datePolicy: 'avoid' | 'allow' } {
  return {
    noDashes: cfg.style?.noDashes ?? true,
    // template que extrai dados verbatim (códigos, cupons...) usa data no título de propósito
    datePolicy: cfg.style?.datePolicy ?? (cfg.extraction.enabled ? 'allow' : 'avoid'),
  };
}
export type TemplatePrompts = z.infer<typeof templatePromptsSchema>;

export function parseTemplateConfig(raw: unknown): TemplateConfig {
  return templateConfigSchema.parse(raw);
}

/** Prompts do locale pedido, caindo no defaultLanguage do template. */
export function promptsForLanguage(cfg: TemplateConfig, language: string): TemplatePrompts {
  const prompts = cfg.prompts[language] ?? cfg.prompts[cfg.defaultLanguage];
  if (!prompts) {
    const available = Object.keys(cfg.prompts).join(', ');
    throw new Error(`Template sem prompts para "${language}" nem para o default "${cfg.defaultLanguage}" (disponíveis: ${available})`);
  }
  return prompts;
}

/** Envelope fixo da resposta de atualização; o dataSchema do template entra em `data`. */
export function buildUpdateResponseSchema(dataSchema: Record<string, unknown>): JsonSchema {
  return {
    type: 'object',
    properties: {
      hasChanges: { type: 'boolean' },
      action: { type: 'string', enum: ['update', 'reorganize', 'rewrite'] },
      noDataFound: { type: 'boolean' },
      newTitle: { type: 'string' },
      updatedHtml: { type: 'string' },
      changesSummary: { type: 'string' },
      // SEO (Fase 2): sempre presentes no envelope (strict mode). Ficam vazio/null
      // quando o template não pede — o prompt é quem instrui a preenchê-los.
      metaDescription: {
        type: 'string',
        description: 'Meta description SEO (120-160 caracteres). "" se o template não pedir.',
      },
      category: {
        anyOf: [{ type: 'string' }, { type: 'null' }],
        description: 'Categoria escolhida entre as disponíveis. null se o template não pedir.',
      },
      data: dataSchema,
    },
    required: [
      'hasChanges',
      'action',
      'noDataFound',
      'newTitle',
      'updatedHtml',
      'changesSummary',
      'metaDescription',
      'category',
      'data',
    ],
    additionalProperties: false,
  };
}

/** Schema fixo da resposta de verificação (genérico para qualquer lista verbatim). */
export function buildVerifyResponseSchema(): JsonSchema {
  return {
    type: 'object',
    properties: {
      approved: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            list: { type: 'string' },
            value: { type: 'string' },
          },
          required: ['list', 'value'],
          additionalProperties: false,
        },
      },
      rejected: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            value: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['value', 'reason'],
          additionalProperties: false,
        },
      },
    },
    required: ['approved', 'rejected'],
    additionalProperties: false,
  };
}

/** Deriva o tópico do título do post (porta da derivação de gameName do n8n). */
export function deriveTopic(title: string, cfg: TemplateConfig['topic']): string {
  let t = title;
  for (const pattern of cfg.stripPatterns) {
    try {
      t = t.replace(new RegExp(pattern, 'gi'), '');
    } catch {
      // pattern inválido no template não pode derrubar o pipeline
    }
  }
  for (const cut of cfg.cutAt) {
    t = t.split(cut)[0] ?? t;
  }
  return t.trim();
}
