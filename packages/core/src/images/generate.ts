import { fetchWithRetry } from '../http/fetch-retry';

/**
 * Geração de imagem via OpenAI (gpt-image-1 / dall-e-3): último recurso do
 * `illustrate` quando nenhuma candidata da web/acervo passa na revisão de
 * qualidade. Só entra em jogo com credencial OpenAI própria do workspace —
 * nunca com a chave da plataforma (ver resolveImageGenProvider no worker).
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
      const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
      const b64 = json.data?.[0]?.b64_json;
      if (!b64) return null;
      return { data: Uint8Array.from(Buffer.from(b64, 'base64')), mimeType: 'image/png' };
    } catch {
      // geração de imagem nunca derruba o post — sem capa é melhor que falhar o pipeline
      return null;
    }
  }
}
