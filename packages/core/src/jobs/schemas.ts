import { z } from 'zod';

/** Schemas dos campos JSONB de content_jobs — compartilhados entre painel (forms) e worker (execução). */

export const postFilterSchema = z.object({
  tags: z.array(z.number().int()).default([]),
  categories: z.array(z.number().int()).default([]),
  perPage: z.number().int().min(1).max(50).default(10),
});
export type PostFilter = z.infer<typeof postFilterSchema>;

export const llmTaskSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'openrouter']),
  model: z.string().min(1),
  /** Credencial específica; ausente = primeira credencial do tipo no workspace. */
  credentialId: z.string().uuid().optional(),
  maxTokens: z.number().int().positive().optional(),
});
export type LlmTask = z.infer<typeof llmTaskSchema>;

export const jobLlmConfigSchema = z.object({
  generate: llmTaskSchema,
  verify: llmTaskSchema,
});
export type JobLlmConfig = z.infer<typeof jobLlmConfigSchema>;

export const jobLimitsSchema = z.object({
  maxPostsPerRun: z.number().int().min(1).max(100).default(10),
  tokenBudgetPerRun: z.number().int().positive().default(500_000),
  skipIfSourcesUnchanged: z.boolean().default(true),
  /**
   * eco: busca basic sem Extract + pré-checagem determinística; IA só quando
   * os códigos mudaram, com contexto reduzido e sem a 2ª chamada de verificação.
   * full: fluxo completo original (mais preciso em posts bagunçados, ~10x mais tokens).
   */
  mode: z.enum(['eco', 'full']).default('eco'),
  /**
   * Profundidade da busca Tavily. 'auto' segue o modo (eco→basic, full→advanced);
   * 'advanced' força busca profunda mesmo no eco (mais créditos Tavily, fontes melhores).
   */
  searchDepth: z.enum(['auto', 'basic', 'advanced']).default('auto'),
});
export type JobLimits = z.infer<typeof jobLimitsSchema>;

/** Presets de cron exibidos no painel. */
export const CRON_PRESETS = [
  { label: '2x por dia (07h e 19h)', value: '0 7,19 * * *' },
  { label: '1x por dia (07h)', value: '0 7 * * *' },
  { label: 'A cada 6 horas', value: '0 */6 * * *' },
  { label: 'A cada 12 horas', value: '0 */12 * * *' },
  { label: 'Semanal (segunda 08h)', value: '0 8 * * 1' },
] as const;
