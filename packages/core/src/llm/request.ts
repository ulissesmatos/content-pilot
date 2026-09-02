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
        ...images.map((url) => ({ type: 'image', source: { type: 'url', url } })),
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
    return {
      url: 'https://api.openai.com/v1/chat/completions',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: {
        model: cfg.model,
        max_tokens: cappedMaxTokens,
        temperature,
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
