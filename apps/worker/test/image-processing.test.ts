import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

/**
 * Testes com `sharp` de verdade: o que importa aqui é o que sai nos pixels
 * (tamanho exato, formato WebP, imagem ruim rejeitada), e isso não se prova com mock.
 * Só a rede é falsa: `publicFetch` serve bytes de memória.
 */

const responses = new Map<string, () => Response>();
vi.mock('@content-pilot/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@content-pilot/core')>();
  return {
    ...actual,
    publicFetch: vi.fn(async (input: string | URL | Request) => {
      const handler = responses.get(String(input));
      if (!handler) return new Response('not found', { status: 404 });
      return handler();
    }),
  };
});

const { MIN_SIDE, prepareCandidate, processForUpload } = await import('../src/lib/image-processing');

/** Imagem com ruído: precisa passar do piso de 5 KB, que uma cor sólida não passa. */
async function noisy(width: number, height: number, format: 'jpeg' | 'png' = 'jpeg'): Promise<Uint8Array> {
  const base = sharp({
    create: { width, height, channels: 3, background: { r: 90, g: 120, b: 160 }, noise: { type: 'gaussian', mean: 128, sigma: 40 } },
  });
  return new Uint8Array(await (format === 'jpeg' ? base.jpeg({ quality: 88 }) : base.png()).toBuffer());
}

const meta = async (data: Uint8Array) => sharp(data).metadata();
const candidate = (url: string) => ({
  url,
  thumbnail: url,
  title: 't',
  license: 'web',
  attribution: '',
  sourcePage: 'https://x.com',
  provider: 'web',
});
const serve = (url: string, body: Uint8Array | string, contentType = 'image/jpeg') =>
  responses.set(url, () => new Response(body as BodyInit, { headers: { 'content-type': contentType } }));

beforeEach(() => responses.clear());

describe('processForUpload', () => {
  const size = { width: 1280, height: 720 };
  const base = { size, quality: 82 };

  it('imagem gerada por IA vira WebP no tamanho EXATO pedido (1536x1024 -> 1280x720)', async () => {
    const png = await noisy(1536, 1024, 'png');
    const out = await processForUpload({ data: png, mimeType: 'image/png' }, { ...base, role: 'cover', format: 'webp', generated: true });
    expect(out.mimeType).toBe('image/webp');
    expect(out.extension).toBe('webp');
    expect(out.width).toBe(1280);
    expect(out.height).toBe(720);
    const m = await meta(out.data);
    expect(m.format).toBe('webp');
    expect([m.width, m.height]).toEqual([1280, 720]);
  });

  it('funciona para os outros tamanhos que o usuário citou (1920x1080 e 700x300)', async () => {
    const png = await noisy(1536, 1024, 'png');
    for (const s of [{ width: 1920, height: 1080 }, { width: 700, height: 300 }]) {
      const out = await processForUpload({ data: png, mimeType: 'image/png' }, { ...base, size: s, role: 'cover', format: 'webp', generated: true });
      expect([out.width, out.height]).toEqual([s.width, s.height]);
    }
  });

  it('capa real também é recortada na proporção da capa', async () => {
    const wide = await noisy(3000, 1000);
    const out = await processForUpload({ data: wide, mimeType: 'image/jpeg' }, { ...base, role: 'cover', format: 'webp', generated: false });
    expect([out.width, out.height]).toEqual([1280, 720]);
  });

  it('imagem real do corpo só reduz: mantém a proporção e não recorta', async () => {
    const photo = await noisy(3000, 2000); // 3:2
    const out = await processForUpload({ data: photo, mimeType: 'image/jpeg' }, { ...base, role: 'inline', format: 'webp', generated: false });
    expect(out.width).toBeLessThanOrEqual(1280);
    expect(out.height).toBeLessThanOrEqual(720);
    expect(Math.abs(out.width / out.height - 3 / 2)).toBeLessThan(0.02);
  });

  it('imagem pequena nunca é esticada', async () => {
    const small = await noisy(640, 480);
    const out = await processForUpload({ data: small, mimeType: 'image/jpeg' }, { ...base, role: 'inline', format: 'webp', generated: false });
    expect([out.width, out.height]).toEqual([640, 480]);
  });

  it('WebP é bem menor que o PNG de origem para a mesma imagem', async () => {
    const png = await noisy(1536, 1024, 'png');
    const out = await processForUpload({ data: png, mimeType: 'image/png' }, { ...base, role: 'cover', format: 'webp', generated: true });
    expect(out.data.byteLength).toBeLessThan(png.byteLength / 2);
  });

  it('format original mantém o tipo do arquivo', async () => {
    const jpg = await noisy(2000, 1200);
    const out = await processForUpload({ data: jpg, mimeType: 'image/jpeg' }, { ...base, role: 'inline', format: 'original', generated: false });
    expect(out.mimeType).toBe('image/jpeg');
    expect(out.extension).toBe('jpg');
  });

  it('bytes que não são imagem: devolve o original em vez de derrubar o post', async () => {
    const junk = new Uint8Array([1, 2, 3, 4, 5]);
    const out = await processForUpload({ data: junk, mimeType: 'image/jpeg' }, { ...base, role: 'cover', format: 'webp', generated: false });
    expect(out.data).toBe(junk);
    expect(out.mimeType).toBe('image/jpeg');
  });
});

describe('prepareCandidate', () => {
  it('imagem boa: devolve miniatura JPEG em base64 de até 640px, e os bytes originais para o upload', async () => {
    const data = await noisy(1600, 900);
    serve('https://cdn.example/ok.jpg', data);
    const prepared = await prepareCandidate(candidate('https://cdn.example/ok.jpg'), 'cover');
    expect(prepared).not.toBeNull();
    expect(prepared!.thumbnail).toMatch(/^data:image\/jpeg;base64,/);
    const thumb = Buffer.from(prepared!.thumbnail.split(',')[1]!, 'base64');
    const m = await sharp(thumb).metadata();
    expect(Math.max(m.width!, m.height!)).toBeLessThanOrEqual(640);
    expect(prepared!.original).toMatchObject({ width: 1600, height: 900, mimeType: 'image/jpeg' });
    expect(prepared!.original.data.byteLength).toBe(data.byteLength);
  });

  it('descarta o que o provedor de IA recusaria: 403, 404 e resposta que não é imagem', async () => {
    responses.set('https://cdn.example/403.jpg', () => new Response('nope', { status: 403 }));
    serve('https://cdn.example/page.jpg', '<html>não sou imagem</html>', 'text/html');
    expect(await prepareCandidate(candidate('https://cdn.example/403.jpg'), 'cover')).toBeNull();
    expect(await prepareCandidate(candidate('https://cdn.example/404.jpg'), 'cover')).toBeNull();
    expect(await prepareCandidate(candidate('https://cdn.example/page.jpg'), 'cover')).toBeNull();
  });

  it('a extensão engana, os bytes não: arquivo com content-type de imagem mas conteúdo lixo é descartado', async () => {
    serve('https://cdn.example/fake.jpg', new Uint8Array(6000).fill(7));
    expect(await prepareCandidate(candidate('https://cdn.example/fake.jpg'), 'cover')).toBeNull();
  });

  it('ícone e thumbnail minúsculo (abaixo de 5 KB) saem', async () => {
    serve('https://cdn.example/icon.png', await sharp({ create: { width: 32, height: 32, channels: 3, background: '#fff' } }).png().toBuffer(), 'image/png');
    expect(await prepareCandidate(candidate('https://cdn.example/icon.png'), 'inline')).toBeNull();
  });

  it('a capa exige mais resolução que o corpo', async () => {
    const data = await noisy(MIN_SIDE.inline + 50, MIN_SIDE.inline + 50); // 450x450: passa no corpo, não na capa
    serve('https://cdn.example/mid.jpg', data);
    expect(await prepareCandidate(candidate('https://cdn.example/mid.jpg'), 'inline')).not.toBeNull();
    expect(await prepareCandidate(candidate('https://cdn.example/mid.jpg'), 'cover')).toBeNull();
  });

  it('banner ultra-largo e faixa vertical não viram capa', async () => {
    serve('https://cdn.example/banner.jpg', await noisy(2400, 500)); // 4.8:1
    serve('https://cdn.example/tall.jpg', await noisy(600, 2400)); // 1:4
    expect(await prepareCandidate(candidate('https://cdn.example/banner.jpg'), 'cover')).toBeNull();
    expect(await prepareCandidate(candidate('https://cdn.example/tall.jpg'), 'cover')).toBeNull();
  });

  it('PNG e WebP de origem também são aceitos', async () => {
    serve('https://cdn.example/a.png', await noisy(900, 700, 'png'), 'image/png');
    serve('https://cdn.example/b.webp', new Uint8Array(await sharp(await noisy(900, 700)).webp().toBuffer()), 'image/webp');
    expect(await prepareCandidate(candidate('https://cdn.example/a.png'), 'cover')).not.toBeNull();
    expect(await prepareCandidate(candidate('https://cdn.example/b.webp'), 'cover')).not.toBeNull();
  });
});
