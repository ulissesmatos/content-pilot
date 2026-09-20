import { fetchWithRetry } from '../http/fetch-retry';

export class ImageGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageGenerationError';
  }
}

/**
 * Geração de imagem via OpenAI (gpt-image-1 / dall-e-3): último recurso do
 * `illustrate` quando nenhuma candidata da web/acervo passa na revisão de
 * qualidade. Usa a credencial OpenAI BYOK; só o super admin, ao desligar a
 * prioridade BYOK, pode usar a chave OpenAI do sistema (ver resolver do
 * worker).
 */

export interface GeneratedImage {
  data: Uint8Array;
  mimeType: string;
}

export interface ImageGenClient {
  generate(prompt: string): Promise<GeneratedImage | null>;
}

/** dall-e-3 só devolve base64 se pedido; gpt-image-1 nem aceita o parâmetro (sempre base64). */
function isDallE(model: string): boolean {
  return /^dall-e/i.test(model);
}

export class OpenAiImageGenClient implements ImageGenClient {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  async generate(prompt: string): Promise<GeneratedImage | null> {
    const body: Record<string, unknown> = {
      model: this.model,
      prompt: prompt.slice(0, 4000),
      size: '1024x1024',
      n: 1,
    };
    if (isDallE(this.model)) body.response_format = 'b64_json';

    try {
      const res = await fetchWithRetry(
        'https://api.openai.com/v1/images/generations',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        { timeoutMs: 120_000, retries: 2, retryDelayMs: 5_000, fetchImpl: this.fetchImpl },
      );
      const json = (await res.json()) as { data?: Array<{ b64_json?: string }>; error?: { message?: string } };
      const b64 = json.data?.[0]?.b64_json;
      if (!b64) {
        throw new ImageGenerationError(json.error?.message ?? 'A API da OpenAI não devolveu dados de imagem.');
      }
      return { data: Uint8Array.from(Buffer.from(b64, 'base64')), mimeType: 'image/png' };
    } catch (err) {
      // O post não falha por uma capa, mas o log precisa dizer POR QUÊ. Antes
      // este catch silencioso fazia chave/modelo/restrição de conta parecerem
      // "busca de imagem instável".
      const reason = err instanceof Error ? err.message : String(err);
      throw new ImageGenerationError(`OpenAI Images (${this.model}): ${reason}`);
    }
  }
}
