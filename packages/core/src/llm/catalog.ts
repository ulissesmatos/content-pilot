import { fetchWithRetry } from '../http/fetch-retry';
import type { LlmProviderName } from './types';

/**
 * Catálogo de modelos dos provedores.
 *
 * A normalização é separada do fetch de propósito: o formato de resposta de
 * cada provedor é o que quebra quando eles mexem na API, e só dá para testar
 * isso sem rede se a transformação for uma função pura.
 *
 * Preço é sempre USD por 1M de tokens — mesma unidade da tabela do core.
 */

export interface CatalogModel {
  provider: LlmProviderName;
  modelId: string;
  displayName: string;
  contextLength: number | null;
  maxOutputTokens: number | null;
  inputPricePerMtok: number | null;
  outputPricePerMtok: number | null;
  priceSource: 'provider' | 'openrouter_match' | 'manual' | 'unknown';
  supportsVision: boolean;
  supportsStructuredOutput: boolean;
  raw: unknown;
}

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';
const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models';

function asArray(body: unknown): unknown[] {
  const data = (body as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? data : [];
}

function num(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * O OpenRouter cobra por token; a tabela toda do projeto é por 1M.
 *
 * Valor negativo é a sentinela de "preço variável" que ele usa nos modelos
 * roteadores (openrouter/auto-beta, fusion): eles escolhem o modelo em tempo
 * de execução, então não há preço fixo. Vira null — desconhecido, nunca zero
 * e nunca negativo.
 */
function perMtok(perToken: unknown): number | null {
  const n = num(perToken);
  if (n === null || n < 0) return null;
  return n * 1_000_000;
}

/**
 * O OpenRouter é a única fonte pública com preço por modelo, e ainda lista os
 * modelos da OpenAI/Anthropic — por isso ele alimenta o preço dos outros dois.
 */
export function normalizeOpenRouterModels(body: unknown): CatalogModel[] {
  return asArray(body).flatMap((entry) => {
    const m = entry as Record<string, unknown>;
    const modelId = typeof m.id === 'string' ? m.id : null;
    if (!modelId) return [];

    const pricing = (m.pricing ?? {}) as Record<string, unknown>;
    const architecture = (m.architecture ?? {}) as Record<string, unknown>;
    const topProvider = (m.top_provider ?? {}) as Record<string, unknown>;
    const modalities = Array.isArray(architecture.input_modalities)
      ? (architecture.input_modalities as unknown[]).map(String)
      : [];
    const params = Array.isArray(m.supported_parameters)
      ? (m.supported_parameters as unknown[]).map(String)
      : [];

    const input = perMtok(pricing.prompt);
    const output = perMtok(pricing.completion);

    return [
      {
        provider: 'openrouter' as const,
        modelId,
        displayName: typeof m.name === 'string' && m.name ? m.name : modelId,
        contextLength: num(m.context_length),
        maxOutputTokens: num(topProvider.max_completion_tokens),
        inputPricePerMtok: input,
        outputPricePerMtok: output,
        priceSource: input !== null || output !== null ? ('provider' as const) : ('unknown' as const),
        supportsVision: modalities.includes('image'),
        supportsStructuredOutput:
          params.includes('structured_outputs') || params.includes('response_format'),
        raw: entry,
      },
    ];
  });
}

/**
 * A OpenAI lista TODO modelo da conta — embeddings, áudio, imagem, moderação.
 * Despejar isso no painel esconderia os poucos que servem aqui.
 */
const OPENAI_NON_CHAT =
  /(embedding|whisper|tts|audio|realtime|dall-e|moderation|image|transcribe|search|codex|davinci|babbage)/i;

export function normalizeOpenAiModels(body: unknown): CatalogModel[] {
  return asArray(body).flatMap((entry) => {
    const m = entry as Record<string, unknown>;
    const modelId = typeof m.id === 'string' ? m.id : null;
    if (!modelId || OPENAI_NON_CHAT.test(modelId)) return [];
    return [
      {
        provider: 'openai' as const,
        modelId,
        displayName: modelId,
        contextLength: null,
        maxOutputTokens: null,
        // a API de modelos da OpenAI não informa preço nem capacidades
        inputPricePerMtok: null,
        outputPricePerMtok: null,
        priceSource: 'unknown' as const,
        supportsVision: false,
        supportsStructuredOutput: false,
        raw: entry,
      },
    ];
  });
}

/** Modelos de geração de imagem da OpenAI — o inverso do filtro de chat acima. */
const OPENAI_IMAGE_GEN = /^(gpt-image|dall-e)/i;

export function normalizeOpenAiImageModels(body: unknown): CatalogModel[] {
  return asArray(body).flatMap((entry) => {
    const m = entry as Record<string, unknown>;
    const modelId = typeof m.id === 'string' ? m.id : null;
    if (!modelId || !OPENAI_IMAGE_GEN.test(modelId)) return [];
    return [
      {
        provider: 'openai' as const,
        modelId,
        displayName: modelId,
        contextLength: null,
        maxOutputTokens: null,
        inputPricePerMtok: null,
        outputPricePerMtok: null,
        priceSource: 'unknown' as const,
        supportsVision: false,
        supportsStructuredOutput: false,
        raw: entry,
      },
    ];
  });
}

export function normalizeAnthropicModels(body: unknown): CatalogModel[] {
  return asArray(body).flatMap((entry) => {
    const m = entry as Record<string, unknown>;
    const modelId = typeof m.id === 'string' ? m.id : null;
    if (!modelId) return [];
    return [
      {
        provider: 'anthropic' as const,
        modelId,
        displayName: typeof m.display_name === 'string' && m.display_name ? m.display_name : modelId,
        contextLength: null,
        maxOutputTokens: null,
        inputPricePerMtok: null,
        outputPricePerMtok: null,
        priceSource: 'unknown' as const,
        // todo Claude atual aceita imagem
        supportsVision: true,
        supportsStructuredOutput: true,
        raw: entry,
      },
    ];
  });
}

/** "openai/gpt-4o" vira "gpt-4o": casa id nativo com id do OpenRouter. */
function bareId(modelId: string): string {
  return (modelId.split('/').pop() ?? modelId).toLowerCase();
}

/**
 * Copia preço e capacidades do equivalente no OpenRouter para os modelos
 * nativos, que vêm sem essa informação. Sem isto, todo modelo chamado direto
 * na OpenAI/Anthropic entraria no catálogo com preço nulo — e custo nulo é
 * exatamente o buraco que este bloco fecha.
 */
export function matchOpenRouterPricing(
  models: CatalogModel[],
  openRouterModels: CatalogModel[],
): CatalogModel[] {
  const byBareId = new Map<string, CatalogModel>();
  for (const m of openRouterModels) {
    const key = bareId(m.modelId);
    // o primeiro vence: a lista do OpenRouter já vem por relevância
    if (!byBareId.has(key)) byBareId.set(key, m);
  }

  return models.map((model) => {
    if (model.inputPricePerMtok !== null && model.outputPricePerMtok !== null) return model;
    const match = byBareId.get(bareId(model.modelId));
    if (!match) return model;
    return {
      ...model,
      inputPricePerMtok: model.inputPricePerMtok ?? match.inputPricePerMtok,
      outputPricePerMtok: model.outputPricePerMtok ?? match.outputPricePerMtok,
      priceSource:
        match.inputPricePerMtok !== null || match.outputPricePerMtok !== null
          ? ('openrouter_match' as const)
          : model.priceSource,
      supportsVision: model.supportsVision || match.supportsVision,
      supportsStructuredOutput: model.supportsStructuredOutput || match.supportsStructuredOutput,
      contextLength: model.contextLength ?? match.contextLength,
      maxOutputTokens: model.maxOutputTokens ?? match.maxOutputTokens,
    };
  });
}

interface FetchOpts {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

async function getJson(
  url: string,
  headers: Record<string, string>,
  opts: FetchOpts,
): Promise<unknown> {
  const res = await fetchWithRetry(
    url,
    { method: 'GET', headers },
    {
      timeoutMs: opts.timeoutMs ?? 30_000,
      retries: 2,
      retryDelayMs: 2_000,
      fetchImpl: opts.fetchImpl,
    },
  );
  return res.json();
}

/** Endpoint público — não exige chave. */
export async function fetchOpenRouterModels(opts: FetchOpts = {}): Promise<CatalogModel[]> {
  return normalizeOpenRouterModels(await getJson(OPENROUTER_MODELS_URL, {}, opts));
}

export async function fetchOpenAiModels(
  apiKey: string,
  opts: FetchOpts = {},
): Promise<CatalogModel[]> {
  return normalizeOpenAiModels(
    await getJson(OPENAI_MODELS_URL, { Authorization: `Bearer ${apiKey}` }, opts),
  );
}

export async function fetchOpenAiImageModels(
  apiKey: string,
  opts: FetchOpts = {},
): Promise<CatalogModel[]> {
  return normalizeOpenAiImageModels(
    await getJson(OPENAI_MODELS_URL, { Authorization: `Bearer ${apiKey}` }, opts),
  );
}

export async function fetchAnthropicModels(
  apiKey: string,
  opts: FetchOpts = {},
): Promise<CatalogModel[]> {
  return normalizeAnthropicModels(
    await getJson(
      ANTHROPIC_MODELS_URL,
      { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      opts,
    ),
  );
}
