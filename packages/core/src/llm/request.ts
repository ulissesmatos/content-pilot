import type { JsonSchema, LlmProviderConfig } from './types';

/**
 * Monta url/headers/body por provedor — porta exata do buildLlmRequest do n8n.
 * Cada provedor tem seu formato de structured output:
 * - Anthropic: output_config.format json_schema
 * - OpenAI: response_format json_schema strict
 * - OpenRouter: json_schema strict OU json_object + plugin response-healing
 */
export interface BuiltLlmRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function isGpt5Model(model: string): boolean {
  return /^gpt-5(?:[.-]|$)/i.test(model);
}

const DATA_URL = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i;

/**
 * Imagem para a Anthropic. URL comum vai como `url` e o servidor DELES baixa;
 * data URL vai como base64. Preferimos base64 sempre que possível (ver
 * illustrate): um único site com anti-hotlink entre as candidatas derrubava a
 * requisição inteira com 400, e o post saía sem imagem sem ninguém saber por quê.
 */
function anthropicImageBlock(url: string) {
  const m = DATA_URL.exec(url);
  return m
    ? { type: 'image', source: { type: 'base64', media_type: m[1]!.toLowerCase(), data: m[2]! } }
    : { type: 'image', source: { type: 'url', url } };
}

export function buildLlmRequest(
  cfg: LlmProviderConfig,
  prompt: string,
  schema: JsonSchema,
  schemaName: string,
  maxTokens: number,
  temperature: number,
  images: string[] = [],
): BuiltLlmRequest {
  const cappedMaxTokens = cfg.maxTokensCap ? Math.min(maxTokens, cfg.maxTokensCap) : maxTokens;

  // Conteúdo do usuário: texto puro, ou array texto+imagens (visão) por provedor.
  const anthropicContent = images.length
    ? [
        { type: 'text', text: prompt },
        ...images.map(anthropicImageBlock),
      ]
    : prompt;
  const openaiContent = images.length
    ? [
        { type: 'text', text: prompt },
        ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
      ]
    : prompt;
  const messages =
    cfg.provider === 'anthropic'
      ? [{ role: 'user', content: anthropicContent }]
      : [{ role: 'user', content: openaiContent }];

  if (cfg.provider === 'openai') {
    const gpt5 = isGpt5Model(cfg.model);
    return {
      url: 'https://api.openai.com/v1/chat/completions',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: {
        model: cfg.model,
        ...(gpt5 ? { max_completion_tokens: cappedMaxTokens } : { max_tokens: cappedMaxTokens, temperature }),
        messages,
        response_format: {
          type: 'json_schema',
          json_schema: { name: schemaName, strict: true, schema },
        },
      },
    };
  }

  if (cfg.provider === 'openrouter') {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (cfg.openrouter?.siteUrl) headers['HTTP-Referer'] = cfg.openrouter.siteUrl;
    if (cfg.openrouter?.appName) headers['X-Title'] = cfg.openrouter.appName;

    const format = cfg.openrouter?.responseFormat ?? 'json_object';
    const body: Record<string, unknown> = {
      model: cfg.model,
      max_tokens: cappedMaxTokens,
      temperature,
      messages,
      // devolve o custo real em USD na resposta (usage.cost) — qualquer modelo
      usage: { include: true },
      response_format:
        format === 'json_schema'
          ? { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } }
          : { type: 'json_object' },
    };
    if (format === 'json_object' && (cfg.openrouter?.responseHealing ?? true)) {
      body.plugins = [{ id: 'response-healing' }];
    }
    return { url: 'https://openrouter.ai/api/v1/chat/completions', headers, body };
  }

  return {
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: {
      model: cfg.model,
      max_tokens: cappedMaxTokens,
      temperature,
      messages,
      output_config: {
        format: { type: 'json_schema', schema },
      },
    },
  };
}
