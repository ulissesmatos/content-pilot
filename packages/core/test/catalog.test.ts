import { describe, expect, it } from 'vitest';
import {
  matchOpenRouterPricing,
  normalizeAnthropicModels,
  normalizeOpenAiModels,
  normalizeOpenRouterModels,
  type CatalogModel,
} from '../src/llm/catalog';

/** Resposta real do OpenRouter, reduzida aos campos que consumimos. */
const OPENROUTER_BODY = {
  data: [
    {
      id: 'z-ai/glm-5.2',
      name: 'Z.AI: GLM 5.2',
      context_length: 200000,
      pricing: { prompt: '0.0000006', completion: '0.0000022' },
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
      top_provider: { max_completion_tokens: 8192 },
      supported_parameters: ['response_format', 'structured_outputs'],
    },
    {
      id: 'openai/gpt-4o',
      name: 'OpenAI: GPT-4o',
      context_length: 128000,
      pricing: { prompt: '0.0000025', completion: '0.00001' },
      architecture: { input_modalities: ['text', 'image'] },
      top_provider: { max_completion_tokens: 16384 },
      supported_parameters: ['structured_outputs'],
    },
    { sem_id: true },
  ],
};

describe('normalizeOpenRouterModels', () => {
  it('converte preço por token para USD por 1M de tokens', () => {
    const [glm] = normalizeOpenRouterModels(OPENROUTER_BODY);
    // 0.0000006 * 1e6 = 0.60
    expect(glm!.inputPricePerMtok).toBeCloseTo(0.6, 6);
    expect(glm!.outputPricePerMtok).toBeCloseTo(2.2, 6);
    expect(glm!.priceSource).toBe('provider');
  });

  it('lê visão pelas modalidades de entrada', () => {
    const models = normalizeOpenRouterModels(OPENROUTER_BODY);
    expect(models.find((m) => m.modelId === 'z-ai/glm-5.2')!.supportsVision).toBe(false);
    expect(models.find((m) => m.modelId === 'openai/gpt-4o')!.supportsVision).toBe(true);
  });

  it('descarta entrada sem id em vez de quebrar a sincronização inteira', () => {
    expect(normalizeOpenRouterModels(OPENROUTER_BODY)).toHaveLength(2);
  });

  it('aguenta resposta vazia ou de formato inesperado', () => {
    expect(normalizeOpenRouterModels({})).toEqual([]);
    expect(normalizeOpenRouterModels(null)).toEqual([]);
    expect(normalizeOpenRouterModels({ data: 'nao e array' })).toEqual([]);
  });

  it('preço -1 (sentinela de preço variável do OpenRouter) vira null', () => {
    // openrouter/auto-beta e afins escolhem o modelo em tempo de execução;
    // -1 * 1e6 chegou a estourar a coluna numeric(12,6) do catálogo
    const [m] = normalizeOpenRouterModels({
      data: [{ id: 'openrouter/auto-beta', pricing: { prompt: '-1', completion: '-1' } }],
    });
    expect(m!.inputPricePerMtok).toBeNull();
    expect(m!.outputPricePerMtok).toBeNull();
    expect(m!.priceSource).toBe('unknown');
  });

  it('preço ausente vira null, não zero — custo desconhecido não é custo zero', () => {
    const [m] = normalizeOpenRouterModels({ data: [{ id: 'x/y', pricing: {} }] });
    expect(m!.inputPricePerMtok).toBeNull();
    expect(m!.priceSource).toBe('unknown');
  });
});

describe('normalizeOpenAiModels', () => {
  it('filtra o que não é modelo de chat', () => {
    const models = normalizeOpenAiModels({
      data: [
        { id: 'gpt-4o' },
        { id: 'gpt-4.1-mini' },
        { id: 'text-embedding-3-large' },
        { id: 'whisper-1' },
        { id: 'dall-e-3' },
        { id: 'tts-1' },
        { id: 'omni-moderation-latest' },
      ],
    });
    expect(models.map((m) => m.modelId)).toEqual(['gpt-4o', 'gpt-4.1-mini']);
  });

  it('não inventa preço: a API de modelos da OpenAI não informa', () => {
    const [m] = normalizeOpenAiModels({ data: [{ id: 'gpt-4o' }] });
    expect(m!.inputPricePerMtok).toBeNull();
    expect(m!.priceSource).toBe('unknown');
  });
});

describe('normalizeAnthropicModels', () => {
  it('usa display_name quando existe', () => {
    const [m] = normalizeAnthropicModels({
      data: [{ id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' }],
    });
    expect(m!.displayName).toBe('Claude Haiku 4.5');
    expect(m!.supportsVision).toBe(true);
  });
});

describe('matchOpenRouterPricing', () => {
  const openRouter = normalizeOpenRouterModels(OPENROUTER_BODY);

  it('preenche o preço de um modelo nativo pelo equivalente no OpenRouter', () => {
    const nativos = normalizeOpenAiModels({ data: [{ id: 'gpt-4o' }] });
    const [m] = matchOpenRouterPricing(nativos, openRouter);
    expect(m!.inputPricePerMtok).toBeCloseTo(2.5, 6);
    expect(m!.outputPricePerMtok).toBeCloseTo(10, 6);
    expect(m!.priceSource).toBe('openrouter_match');
    // capacidades vêm junto: é o que impede escolher modelo sem visão em illustrate
    expect(m!.supportsVision).toBe(true);
  });

  it('não sobrescreve preço que o próprio provedor informou', () => {
    const comPreco: CatalogModel[] = [
      {
        provider: 'openai',
        modelId: 'gpt-4o',
        displayName: 'gpt-4o',
        contextLength: null,
        maxOutputTokens: null,
        inputPricePerMtok: 99,
        outputPricePerMtok: 99,
        priceSource: 'provider',
        supportsVision: false,
        supportsStructuredOutput: false,
        raw: null,
      },
    ];
    const [m] = matchOpenRouterPricing(comPreco, openRouter);
    expect(m!.inputPricePerMtok).toBe(99);
    expect(m!.priceSource).toBe('provider');
  });

  it('modelo sem equivalente passa intacto', () => {
    const nativos = normalizeAnthropicModels({ data: [{ id: 'claude-inedito-9' }] });
    const [m] = matchOpenRouterPricing(nativos, openRouter);
    expect(m!.inputPricePerMtok).toBeNull();
    expect(m!.priceSource).toBe('unknown');
  });
});
