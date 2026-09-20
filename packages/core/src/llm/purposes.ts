/**
 * Os cinco pontos do pipeline que chamam um LLM. A lista vive aqui porque
 * três lugares precisam concordar: a coluna `llm_calls.purpose`, as entradas
 * de um perfil de modelo e a UI do painel.
 */
export const LLM_PURPOSES = ['generate', 'verify', 'discover', 'dedupe', 'illustrate', 'review'] as const;

export type LlmPurpose = (typeof LLM_PURPOSES)[number];

/** `illustrate` manda imagem ao modelo — sem visão, o post sai sem capa. */
export const VISION_PURPOSES: ReadonlySet<LlmPurpose> = new Set<LlmPurpose>(['illustrate']);

export const PURPOSE_LABEL: Record<LlmPurpose, string> = {
  generate: 'Geração do artigo',
  verify: 'Verificação dos dados',
  discover: 'Descoberta de pautas',
  dedupe: 'Deduplicação de pautas',
  illustrate: 'Escolha da imagem (visão)',
  review: 'Revisão editorial',
};
