export type LlmProviderName = 'anthropic' | 'openai' | 'openrouter';

export type JsonSchema = Record<string, unknown>;

export interface LlmProviderConfig {
  provider: LlmProviderName;
  model: string;
  apiKey: string;
  maxTokensCap?: number;
  /** OpenRouter: atribuição no ranking + modo de structured output. */
  openrouter?: {
    siteUrl?: string;
    appName?: string;
    responseFormat?: 'json_schema' | 'json_object';
    responseHealing?: boolean;
  };
}

export interface LlmCompleteRequest {
  prompt: string;
  schema: JsonSchema;
  schemaName: string;
  maxTokens: number;
  temperature: number;
}

export interface LlmCompleteResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  truncated: boolean;
  provider: LlmProviderName;
  model: string;
  durationMs: number;
}

export interface LlmProvider {
  readonly provider: LlmProviderName;
  readonly model: string;
  complete(req: LlmCompleteRequest): Promise<LlmCompleteResult>;
}
