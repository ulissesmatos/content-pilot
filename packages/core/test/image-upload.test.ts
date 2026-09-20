import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { ImageUploadError, MAX_UPLOAD_BYTES, processUploadedImage } from '../src/images/process';

/**
 * Imagem enviada pelo usuário (arquivo, colagem, arrastada da web) até o arquivo final: sempre
 * WebP, capa recortada no tamanho exato, imagem do texto só reduzida. Sharp real, sem mocks.
 */

const COVER = { width: 1280, height: 720 };
const INLINE = { width: 1280, height: 720 };

async function photo(width: number, height: number, format: 'png' | 'jpeg' | 'webp' | 'gif' = 'png') {
  const img = sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 120, b: 200 }, noise: { type: 'gaussian', mean: 128, sigma: 50 } },
  });
  const buf = format === 'png' ? await img.png().toBuffer() : format === 'jpeg' ? await img.jpeg({ quality: 95 }).toBuffer() : format === 'gif' ? await img.gif().toBuffer() : await img.webp().toBuffer();
  return new Uint8Array(buf);
}

describe('processUploadedImage', () => {
  it('PNG grande vira WebP bem menor, e o resultado é mesmo WebP', async () => {
    const src = await photo(2000, 1333, 'png');
    const out = await processUploadedImage(src, { size: INLINE, role: 'inline', quality: 82 });
    const meta = await sharp(out.data).metadata();
    expect(meta.format).toBe('webp');
    expect(out.mimeType).toBe('image/webp');
    expect(out.extension).toBe('webp');
    expect(out.data.byteLength).toBeLessThan(src.byteLength / 3);
    expect(out.sourceBytes).toBe(src.byteLength);
  });

  it('capa: recorte exato no tamanho do template, qualquer que seja a proporção original', async () => {
    for (const [w, h] of [[2000, 1333], [1400, 2400], [1600, 1600]] as const) {
      const out = await processUploadedImage(await photo(w, h), { size: COVER, role: 'cover', quality: 80 });
      const meta = await sharp(out.data).metadata();
      expect([meta.width, meta.height], `${w}x${h}`).toEqual([1280, 720]);
      expect(out.upscaled).toBe(false);
    }
  });

  it('capa menor que o tamanho pedido é ampliada e avisa que pode ficar borrada', async () => {
    const out = await processUploadedImage(await photo(640, 360), { size: COVER, role: 'cover', quality: 80 });
    expect([out.width, out.height]).toEqual([1280, 720]);
    expect(out.upscaled).toBe(true);
    expect([out.sourceWidth, out.sourceHeight]).toEqual([640, 360]);
  });

  it('imagem do texto: só reduz, mantém a proporção e nunca amplia', async () => {
    const big = await processUploadedImage(await photo(2400, 800), { size: INLINE, role: 'inline', quality: 80 });
    expect([big.width, big.height]).toEqual([1280, 427]);
    const small = await processUploadedImage(await photo(600, 400), { size: INLINE, role: 'inline', quality: 80 });
    expect([small.width, small.height]).toEqual([600, 400]);
    expect(small.upscaled).toBe(false);
  });

  it('aceita JPEG, WebP e GIF (primeiro quadro), e converte todos para WebP', async () => {
    for (const fmt of ['jpeg', 'webp', 'gif'] as const) {
      const out = await processUploadedImage(await photo(800, 600, fmt), { size: INLINE, role: 'inline', quality: 80 });
      expect((await sharp(out.data).metadata()).format, fmt).toBe('webp');
    }
  });

  it('foto de celular em retrato (orientação EXIF) sai na posição certa, e o tamanho de origem já é o girado', async () => {
    // 800x400 gravado "deitado" com orientação 6 (girar 90°): na tela é um retrato 400x800
    const src = new Uint8Array(await sharp(await photo(800, 400)).withMetadata({ orientation: 6 }).jpeg().toBuffer());
    const out = await processUploadedImage(src, { size: INLINE, role: 'inline', quality: 80 });
    expect([out.sourceWidth, out.sourceHeight]).toEqual([400, 800]);
    expect(out.height).toBeGreaterThan(out.width);
  });

  it('a WebP resultante não carrega metadados (localização, câmera) do arquivo original', async () => {
    const src = new Uint8Array(
      await sharp(await photo(800, 600)).withExif({ IFD0: { Copyright: 'Fulano', Artist: 'Beltrano' } }).jpeg().toBuffer(),
    );
    const out = await processUploadedImage(src, { size: INLINE, role: 'inline', quality: 80 });
    const meta = await sharp(out.data).metadata();
    expect(meta.exif).toBeUndefined();
  });

  it('recusa arquivo vazio, texto disfarçado de imagem, SVG e imagem minúscula, com mensagem para o usuário', async () => {
    const bad = async (data: Uint8Array) => processUploadedImage(data, { size: INLINE, role: 'inline', quality: 80 }).catch((e: unknown) => e);

    const empty = await bad(new Uint8Array());
    expect(empty).toBeInstanceOf(ImageUploadError);
    expect((empty as ImageUploadError).code).toBe('invalid');

    const text = await bad(new TextEncoder().encode('isto não é uma imagem, é só texto qualquer'));
    expect((text as ImageUploadError).code).toBe('invalid');

    const svg = await bad(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><script>alert(1)</script><rect width="200" height="200"/></svg>'));
    expect(svg).toBeInstanceOf(ImageUploadError);
    expect(['unsupported', 'invalid']).toContain((svg as ImageUploadError).code);

    const tiny = await bad(await photo(50, 50));
    expect((tiny as ImageUploadError).code).toBe('too_small');
    expect((tiny as ImageUploadError).message).toMatch(/pequena demais/);
  });

  it('recusa arquivo acima do limite antes de gastar CPU', async () => {
    const huge = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    const err = await processUploadedImage(huge, { size: INLINE, role: 'inline', quality: 80 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImageUploadError);
    expect((err as ImageUploadError).code).toBe('too_large');
  });
});
