import { describe, expect, it } from 'vitest';
import { buildLlmRequest } from '../src/llm/request';
import { extractJson, extractResponseText, extractUsage, isTruncated } from '../src/llm/parse';

const SCHEMA = { type: 'object', properties: { x: { type: 'string' } }, required: ['x'], additionalProperties: false };

describe('buildLlmRequest', () => {
  it('anthropic: output_config json_schema + headers', () => {
    const r = buildLlmRequest(
      { provider: 'anthropic', model: 'claude-haiku-4-5', apiKey: 'sk-a' },
      'p',
      SCHEMA,
      's',
      16000,
      0.2,
    );
    expect(r.url).toContain('api.anthropic.com/v1/messages');
    expect(r.headers['x-api-key']).toBe('sk-a');
    expect(r.headers['anthropic-version']).toBe('2023-06-01');
    expect(r.body.output_config).toEqual({ format: { type: 'json_schema', schema: SCHEMA } });
  });

  it('openai: response_format json_schema strict', () => {
    const r = buildLlmRequest({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-o' }, 'p', SCHEMA, 'meu_schema', 8000, 0);
    expect(r.url).toContain('api.openai.com');
    expect(r.headers.Authorization).toBe('Bearer sk-o');
    expect(r.body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'meu_schema', strict: true, schema: SCHEMA },
    });
  });

  it('openrouter: json_object + response-healing + headers de atribuição', () => {
    const r = buildLlmRequest(
      {
        provider: 'openrouter',
        model: 'meta/llama-3',
        apiKey: 'sk-or',
        openrouter: { siteUrl: 'https://ex.com', appName: 'CP', responseFormat: 'json_object', responseHealing: true },
      },
      'p',
      SCHEMA,
      's',
      8000,
      0,
    );
    expect(r.url).toContain('openrouter.ai');
    expect(r.headers['HTTP-Referer']).toBe('https://ex.com');
    expect(r.headers['X-Title']).toBe('CP');
    expect(r.body.response_format).toEqual({ type: 'json_object' });
    expect(r.body.plugins).toEqual([{ id: 'response-healing' }]);
  });

  it('respeita o cap de max_tokens', () => {
    const r = buildLlmRequest(
      { provider: 'anthropic', model: 'm', apiKey: 'k', maxTokensCap: 4000 },
      'p',
      SCHEMA,
      's',
      16000,
      0,
    );
    expect(r.body.max_tokens).toBe(4000);
  });
});

describe('parse de respostas', () => {
  it('extrai texto do formato Anthropic e OpenAI', () => {
    expect(extractResponseText({ content: [{ type: 'text', text: 'abc' }] })).toBe('abc');
    expect(extractResponseText({ choices: [{ message: { content: 'xyz' } }] })).toBe('xyz');
  });

  it('extrai usage dos dois formatos', () => {
    expect(extractUsage({ usage: { input_tokens: 10, output_tokens: 5 } })).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(extractUsage({ usage: { prompt_tokens: 7, completion_tokens: 3 } })).toEqual({ inputTokens: 7, outputTokens: 3 });
  });

  it('detecta truncamento nos dois formatos', () => {
    expect(isTruncated({ stop_reason: 'max_tokens' })).toBe(true);
    expect(isTruncated({ choices: [{ finish_reason: 'length' }] })).toBe(true);
    expect(isTruncated({ stop_reason: 'end_turn' })).toBe(false);
  });

  it('extractJson: JSON puro, com fence e com texto ao redor', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Claro! Aqui está: {"a":{"b":"tem } dentro"}} fim')).toEqual({ a: { b: 'tem } dentro' } });
    expect(extractJson('sem json aqui')).toBeNull();
  });
});
