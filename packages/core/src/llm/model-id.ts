import type { LlmProviderName } from './types';

/**
 * Normalização de id de modelo entre o formato do OpenRouter e o nativo.
 *
 * O OpenRouter endereça modelos como `fornecedor/modelo`
 * ("openai/gpt-4o-mini"). As APIs nativas da OpenAI e da Anthropic só aceitam
 * o id nu ("gpt-4o-mini") e respondem HTTP 400 ao receber a barra — um erro
 * que só aparece na execução, nunca no salvamento.
 *
 * Isso acontece de verdade porque os perfis semeados usam ids do OpenRouter:
 * trocar só o provedor da etapa no painel deixa o id antigo para trás.
 *
 * Duas situações bem diferentes se escondem atrás da mesma barra, e por isso
 * esta função diagnostica em vez de "consertar" tudo:
 *
 *  - `openai/gpt-4o-mini` com provider `openai` — o prefixo apenas REPETE o
 *    provedor escolhido. A intenção é inequívoca e a correção é segura:
 *    remover o prefixo. Aplicada aqui mesmo.
 *  - `anthropic/claude-haiku-4.5` com provider `openai` — o id é de OUTRO
 *    fornecedor. Remover o prefixo inventaria um modelo que a OpenAI não tem;
 *    só o OpenRouter roteia isso. Não há correção segura, então a função
 *    apenas relata e quem chama decide (recusar o salvamento ou, num reparo
 *    de linha já quebrada, trocar o provedor para openrouter).
 */

/** Provedores cuja API só aceita o id nu, sem prefixo de fornecedor. */
const NATIVE_PROVIDERS: ReadonlySet<LlmProviderName> = new Set<LlmProviderName>(['openai', 'anthropic']);

export interface ModelIdCheck {
  /** Já corrigidos quando `fix === 'stripped-prefix'`; iguais à entrada nos demais casos. */
  provider: LlmProviderName;
  modelId: string;
  /**
   * `null` = nada a fazer. `'stripped-prefix'` = corrigido aqui.
   * `'foreign-vendor'` = precisa de decisão de quem chama.
   */
  fix: 'stripped-prefix' | 'foreign-vendor' | null;
  /** O fornecedor lido do prefixo, quando `fix === 'foreign-vendor'`. */
  vendor?: string;
}

export function checkProviderModel(provider: LlmProviderName, rawModelId: string): ModelIdCheck {
  const modelId = rawModelId.trim();

  // O OpenRouter EXIGE o prefixo: lá ele não é erro, é o endereço do modelo.
  if (!NATIVE_PROVIDERS.has(provider)) return { provider, modelId, fix: null };

  const slash = modelId.indexOf('/');
  if (slash <= 0) return { provider, modelId, fix: null };

  const vendor = modelId.slice(0, slash);
  const rest = modelId.slice(slash + 1).trim();
  // "openai/" sem modelo é lixo, não um prefixo a remover — deixa a validação
  // normal recusar em vez de transformar num id vazio.
  if (!rest) return { provider, modelId, fix: null };

  if (vendor.trim().toLowerCase() === provider) {
    return { provider, modelId: rest, fix: 'stripped-prefix' };
  }
  return { provider, modelId, fix: 'foreign-vendor', vendor };
}

/**
 * Versão para quem só quer o par utilizável, aplicando apenas a correção
 * segura. Um id de outro fornecedor passa intacto e falha adiante com a
 * mensagem do provedor — melhor do que trocar em silêncio a chave usada.
 */
export function normalizeProviderModel(
  provider: LlmProviderName,
  modelId: string,
): { provider: LlmProviderName; modelId: string } {
  const { provider: p, modelId: m } = checkProviderModel(provider, modelId);
  return { provider: p, modelId: m };
}
