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

export interface ImageSize {
  width: number;
  height: number;
}

export interface GeneratedImage {
  data: Uint8Array;
  mimeType: string;
}

export interface ImageGenOptions {
  /**
   * Tamanho FINAL desejado. A API só oferece alguns tamanhos nativos, então o
   * cliente pede o mais próximo em proporção e quem recebe recorta/redimensiona
   * até o tamanho exato (o worker faz isso ao converter para WebP).
   */
  size?: ImageSize;
}

export interface ImageGenClient {
  generate(prompt: string, opts?: ImageGenOptions): Promise<GeneratedImage | null>;
}

/** dall-e-3 só devolve base64 se pedido; gpt-image-1 nem aceita o parâmetro (sempre base64). */
function isDallE(model: string): boolean {
  return /^dall-e/i.test(model);
}

/**
 * Tamanho nativo mais próximo da proporção pedida.
 *
 * gpt-image-*: 1024x1024, 1536x1024 (paisagem), 1024x1536 (retrato).
 * dall-e-3:    1024x1024, 1792x1024 (paisagem), 1024x1792 (retrato).
 *
 * 1280x720 ou 1920x1080 não existem como tamanho nativo; pedimos a paisagem e
 * recortamos. Sem tamanho pedido, quadrado (o comportamento de sempre).
 */
export function pickApiSize(model: string, target?: ImageSize): string {
  const dalle = isDallE(model);
  if (!target || target.width <= 0 || target.height <= 0) return '1024x1024';
  const ratio = target.width / target.height;
  if (ratio >= 1.25) return dalle ? '1792x1024' : '1536x1024';
  if (ratio <= 0.8) return dalle ? '1024x1792' : '1024x1536';
  return '1024x1024';
}

export class OpenAiImageGenClient implements ImageGenClient {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  async generate(prompt: string, opts: ImageGenOptions = {}): Promise<GeneratedImage | null> {
    const body: Record<string, unknown> = {
      model: this.model,
      prompt: prompt.slice(0, 4000),
      size: pickApiSize(this.model, opts.size),
      n: 1,
    };
    if (isDallE(this.model)) body.response_format = 'b64_json';
    // gpt-image cobra por qualidade: "medium" é o ponto em que a imagem de blog
    // fica boa sem o custo do "high" (o usuário paga a própria chave).
    else if (/^gpt-image/i.test(this.model)) body.quality = 'medium';

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
