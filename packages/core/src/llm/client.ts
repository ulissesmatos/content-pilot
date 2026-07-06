import { fetchWithRetry } from '../http/fetch-retry';
import { buildLlmRequest } from './request';
import { extractResponseText, extractUsage, isTruncated } from './parse';
import type { LlmCompleteRequest, LlmCompleteResult, LlmProvider, LlmProviderConfig } from './types';

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmError';
  }
}

/** Cliente HTTP multi-provedor. Erros de rede/HTTP viram LlmError (o pipeline decide pular o post). */
export class HttpLlmProvider implements LlmProvider {
  readonly provider;
  readonly model;

  constructor(
    private readonly cfg: LlmProviderConfig,
    private readonly fetchImpl?: typeof fetch,
  ) {
    this.provider = cfg.provider;
    this.model = cfg.model;
  }

  async complete(req: LlmCompleteRequest): Promise<LlmCompleteResult> {
    const { url, headers, body } = buildLlmRequest(
      this.cfg,
      req.prompt,
      req.schema,
      req.schemaName,
      req.maxTokens,
      req.temperature,
    );

    const startedAt = Date.now();
    let json: unknown;
    try {
      const res = await fetchWithRetry(
        url,
        { method: 'POST', headers, body: JSON.stringify(body) },
        { timeoutMs: 300_000, retries: 2, retryDelayMs: 5_000, fetchImpl: this.fetchImpl },
      );
      json = await res.json();
    } catch (err) {
      throw new LlmError(
        `Falha na chamada da API LLM (${this.cfg.provider}/${this.cfg.model}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const errField = (json as Record<string, unknown>)?.error;
    if (errField) {
      const msg =
        typeof errField === 'string' ? errField : ((errField as Record<string, unknown>).message as string) ?? JSON.stringify(errField).slice(0, 300);
      throw new LlmError(`Erro da API LLM (${this.cfg.provider}): ${msg}`);
    }

    const text = extractResponseText(json);
    const usage = extractUsage(json);
    return {
      text,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: usage.costUsd,
      truncated: isTruncated(json),
      provider: this.cfg.provider,
      model: this.cfg.model,
      durationMs: Date.now() - startedAt,
    };
  }
}
