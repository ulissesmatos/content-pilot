import { z } from 'zod';
import { llmTaskSchema } from '../jobs/schemas';
import type { JsonSchema } from '../llm/types';

/**
 * Schemas do modo Autopilot (Fase 1 do roadmap): descoberta autônoma de temas.
 * O Autopilot busca tendências no nicho do site, o LLM classifica candidatos e
 * um passo de dedup (determinístico + LLM) descarta o que já foi publicado.
 * Cada candidato sobrevivente vira uma pauta (brief) — a fábrica de posts que
 * já existe. Tudo com decisões pequenas e estruturadas: funciona em mini-modelos.
 */

/** Tipos de conteúdo que o Autopilot pode decidir produzir. */
export const CONTENT_TYPES = ['evergreen', 'news', 'list', 'guide'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  evergreen: 'Evergreen (atemporal)',
  news: 'Notícia',
  list: 'Lista',
  guide: 'Guia',
};

/**
 * LEGADO, como em `llmTaskSchema`: o modelo de cada etapa vem do perfil do
 * admin. Mantido opcional para as configs já gravadas continuarem validando.
 */
export const autopilotLlmConfigSchema = z.object({
  discover: llmTaskSchema.optional(),
  generate: llmTaskSchema.optional(),
  verify: llmTaskSchema.optional(),
});
export type AutopilotLlmConfig = z.infer<typeof autopilotLlmConfigSchema>;

/** Ajustes de descoberta guardados no JSONB `discovery` da config. */
export const autopilotDiscoverySchema = z.object({
  /** Quantos temas novos virar pauta por ciclo. */
  postsPerCycle: z.number().int().min(1).max(20).default(3),
  /** Tipos de conteúdo permitidos (vazio = todos). */
  allowedTypes: z.array(z.enum(CONTENT_TYPES)).default([]),
  /**
   * Quantos posts recentes do WP considerar no dedup. Títulos + slugs leves,
   * sem baixar conteúdo — só para o LLM saber o que já existe.
   */
  dedupeLookback: z.number().int().min(20).max(400).default(120),
  /** Orçamento de tokens da fase de descoberta (a geração tem o seu próprio). */
  discoverTokenBudget: z.number().int().positive().default(60_000),
});
export type AutopilotDiscovery = z.infer<typeof autopilotDiscoverySchema>;

export function parseAutopilotDiscovery(raw: unknown): AutopilotDiscovery {
  return autopilotDiscoverySchema.parse(raw ?? {});
}

/**
 * Kill-switches da Fase 4 — guardados no JSONB `limits` da config.
 * Todos determinísticos e verificados ANTES de gastar IA:
 * - monthlyBudgetUsd: teto de custo LLM no mês (descoberta + geração + visão).
 * - maxPostsPerDay: máximo de pautas criadas por dia por esta config.
 * - generationTokenBudget: orçamento de tokens de CADA geração de post.
 */
export const autopilotLimitsSchema = z.object({
  monthlyBudgetUsd: z.number().positive().max(10_000).default(20),
  maxPostsPerDay: z.number().int().min(1).max(50).default(5),
  generationTokenBudget: z.number().int().positive().default(300_000),
});
export type AutopilotLimits = z.infer<typeof autopilotLimitsSchema>;

export function parseAutopilotLimits(raw: unknown): AutopilotLimits {
  return autopilotLimitsSchema.parse(raw ?? {});
}

/** Um tema candidato proposto pelo LLM de descoberta. */
export interface DiscoveryCandidate {
  topic: string;
  contentType: ContentType;
  keywords: string[];
  /** Ângulo/gancho editorial em 1 frase. */
  angle: string;
  /** Título SEO sugerido (revisável depois na geração). */
  suggestedTitle: string;
  /**
   * Trecho LITERAL das fontes buscadas que comprova a afirmação central do
   * ângulo — não só que o assunto existe, mas a característica específica que
   * o tema promete. Checado de forma determinística contra o texto real das
   * fontes (ver `runDiscovery`): sem citação real, o candidato é descartado
   * antes de virar pauta. Sem isto, um ângulo inventado (ex.: um modo de jogo
   * que o jogo não tem) só seria pego, se pego, depois de gastar a geração
   * inteira do artigo.
   */
  evidenceQuote: string;
}

/** Schema de saída da chamada de classificação (structured output). */
export function buildDiscoveryResponseSchema(): JsonSchema {
  return {
    type: 'object',
    properties: {
      candidates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'Tema específico e pesquisável, sem enrolação.' },
            contentType: { type: 'string', enum: [...CONTENT_TYPES] },
            keywords: { type: 'array', items: { type: 'string' } },
            angle: { type: 'string', description: 'Gancho editorial em 1 frase.' },
            suggestedTitle: { type: 'string', description: 'Título SEO com a keyword principal.' },
            evidenceQuote: {
              type: 'string',
              description:
                'Trecho copiado EXATAMENTE (sem parafrasear) dos resultados de busca que comprova a característica específica do ângulo — não apenas que o assunto/jogo existe. Sem uma citação real assim, não proponha o candidato.',
            },
          },
          required: ['topic', 'contentType', 'keywords', 'angle', 'suggestedTitle', 'evidenceQuote'],
          additionalProperties: false,
        },
      },
    },
    required: ['candidates'],
    additionalProperties: false,
  };
}

/** Schema de saída da chamada de dedup semântico. */
export function buildDedupeResponseSchema(): JsonSchema {
  return {
    type: 'object',
    properties: {
      decisions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer', description: 'Índice do candidato na lista enviada (base 0).' },
            keep: { type: 'boolean' },
            reason: { type: 'string', description: 'Motivo curto (por que manter ou descartar).' },
          },
          required: ['index', 'keep', 'reason'],
          additionalProperties: false,
        },
      },
    },
    required: ['decisions'],
    additionalProperties: false,
  };
}
