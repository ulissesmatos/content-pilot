import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import type { CmsAdapter, CmsMediaUpload, ImageGenClient, LlmCompleteRequest, LlmProvider } from '@content-pilot/core';

/**
 * Fluxo completo do worker: escolha, geração, conversão para WebP e upload, com
 * sharp de verdade e só a rede falsa. Prova o que o WordPress recebe.
 */

const pages = new Map<string, () => Response>();
vi.mock('@content-pilot/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@content-pilot/core')>();
  return {
    ...actual,
    publicFetch: vi.fn(async (input: string | URL | Request) => {
      const handler = pages.get(String(input));
      return handler ? handler() : new Response('nada', { status: 404 });
    }),
    // sem rede: o acervo aberto não é o assunto destes testes
    OpenverseClient: class {
      async search() {
        return [];
      }
    },
  };
});

const { illustratePost } = await import('../src/lib/illustrate-post');

const HTML =
  '<!-- wp:paragraph --><p>Introdução sobre o Roblox e o novo chat entre amigos que chegou ao aplicativo.</p><!-- /wp:paragraph -->' +
  '<!-- wp:heading {"level":3} --><h3>Como ativar</h3><!-- /wp:heading -->' +
  '<!-- wp:paragraph --><p>Abra o aplicativo e toque na aba de amigos para ver a novidade.</p><!-- /wp:paragraph -->' +
  '<!-- wp:paragraph --><p>Depois escolha um amigo e comece a conversar com ele.</p><!-- /wp:paragraph -->' +
  '<!-- wp:paragraph --><p>Encerramos com dicas de segurança para os pais.</p><!-- /wp:paragraph -->';

async function noisy(w: number, h: number, format: 'jpeg' | 'png' = 'jpeg') {
  const img = sharp({
    create: { width: w, height: h, channels: 3, background: { r: 80, g: 130, b: 90 }, noise: { type: 'gaussian', mean: 128, sigma: 40 } },
  });
  return new Uint8Array(await (format === 'jpeg' ? img.jpeg({ quality: 88 }) : img.png()).toBuffer());
}

function fakeWp() {
  const uploads: Array<CmsMediaUpload & { size: { width?: number; height?: number; format?: string } }> = [];
  let id = 500;
  const wp = {
    async uploadMedia(input: CmsMediaUpload) {
      const m = await sharp(input.data).metadata();
      uploads.push({ ...input, size: { width: m.width, height: m.height, format: m.format } });
      id += 1;
      return { id, sourceUrl: `https://blog.example/wp-content/uploads/${input.filename}` };
    },
  } as unknown as CmsAdapter;
  return { wp, uploads };
}

function vision(reply: object | Error): LlmProvider & { calls: LlmCompleteRequest[] } {
  const calls: LlmCompleteRequest[] = [];
  return {
    provider: 'openai',
    model: 'gpt-5.4-mini',
    calls,
    async complete(req) {
      calls.push(req);
      if (reply instanceof Error) throw reply;
      return { text: JSON.stringify(reply), inputTokens: 1, outputTokens: 1, costUsd: null, truncated: false, provider: 'openai', model: 'gpt-5.4-mini', durationMs: 1 };
    },
  };
}

const imageGen = (fail = false): ImageGenClient & { calls: number } => {
  const gen = {
    calls: 0,
    async generate() {
      gen.calls++;
      if (fail) throw new Error('sem cota');
      return { data: await noisy(1536, 1024, 'png'), mimeType: 'image/png' };
    },
  };
  return gen;
};

const search = (urls: string[]) => ({
  async search() {
    return { results: [] };
  },
  async extract() {
    return { results: [], failed_results: [] };
  },
  async searchImages() {
    return urls.map((url) => ({ url, description: 'roblox chat' }));
  },
});

const base = {
  topic: 'Chat entre amigos do Roblox',
  keywords: ['roblox chat'],
  language: 'pt-BR',
  html: HTML,
  candidates: 4,
  inlineCount: 1,
  coverSize: { width: 1280, height: 720 },
  inlineSize: { width: 1280, height: 720 },
  format: 'webp' as const,
  quality: 82,
};

beforeEach(() => pages.clear());

describe('illustratePost (sharp real, WordPress falso)', () => {
  it('capa real escolhida pela visão sobe como WebP 1280x720 com alt do modelo', async () => {
    const photo = await noisy(2000, 1200);
    pages.set('https://cdn.example/a.jpg', () => new Response(photo as BodyInit, { headers: { 'content-type': 'image/jpeg' } }));
    const { wp, uploads } = fakeWp();

    const out = await illustratePost({
      ...base, wp, inlineCount: 0,
      search: search(['https://cdn.example/a.jpg']),
      llmVision: vision({ index: 0, alt: 'aba de amigos no app do Roblox', qualityOk: true, fits: true, reason: 'ok' }),
    });

    expect(out.coverMissing).toBe(false);
    expect(out.mediaId).toBe(501);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({ mimeType: 'image/webp', alt: 'aba de amigos no app do Roblox' });
    expect(uploads[0]!.filename).toMatch(/\.webp$/);
    expect(uploads[0]!.size).toEqual({ width: 1280, height: 720, format: 'webp' });
    expect(out.report.images[0]).toMatchObject({ slotId: 'cover', origin: 'search', mediaId: 501, width: 1280, height: 720 });
  });

  it('o caso do log real: candidata bloqueada + visão falha, e AINDA sai capa (gerada, 1280x720 WebP)', async () => {
    const { LlmError } = await import('@content-pilot/core');
    const { wp, uploads } = fakeWp();
    const gen = imageGen();
    // a única candidata da busca dá 403 (anti-hotlink): antes derrubava a visão inteira
    pages.set('https://blocked.example/x.jpg', () => new Response('forbidden', { status: 403 }));

    const out = await illustratePost({
      ...base, wp, inlineCount: 0, imageGen: gen,
      search: search(['https://blocked.example/x.jpg']),
      llmVision: vision(new LlmError('HTTP 400')),
    });

    expect(out.coverMissing).toBe(false);
    expect(gen.calls).toBe(1);
    expect(uploads[0]!.size).toEqual({ width: 1280, height: 720, format: 'webp' });
    expect(out.report.images[0]).toMatchObject({ origin: 'generated' });
  });

  it('sem nenhuma imagem e sem gerador: coverMissing, nada sobe, e o motivo fica no relatório', async () => {
    const { wp, uploads } = fakeWp();
    const out = await illustratePost({
      ...base, wp, inlineCount: 0,
      search: search([]),
      llmVision: vision({ index: -1, alt: '', qualityOk: false, fits: false, reason: 'nada' }),
    });
    expect(out.coverMissing).toBe(true);
    expect(out.mediaId).toBeNull();
    expect(uploads).toHaveLength(0);
    expect(out.report.coverMissing).toBe(true);
    expect(out.report.notes.join(' ')).toMatch(/nenhuma candidata|não há gerador/);
  });

  it('gerador com erro (cota): sem capa, e o motivo do erro fica registrado', async () => {
    const { wp } = fakeWp();
    const out = await illustratePost({
      ...base, wp, inlineCount: 0, imageGen: imageGen(true),
      search: search([]),
      llmVision: vision({ index: -1, alt: '', qualityOk: false, fits: false, reason: '' }),
    });
    expect(out.coverMissing).toBe(true);
    expect(out.report.notes.join(' ')).toMatch(/sem cota/);
  });

  it('a imagem do corpo volta ao ponto do PRÓPRIO slot, com o ID da mídia do WP', async () => {
    const { wp } = fakeWp();
    const out = await illustratePost({
      ...base, wp, inlineCount: 1, imageGen: imageGen(),
      search: search([]),
      llmVision: vision({ index: -1, alt: '', qualityOk: false, fits: false, reason: '' }),
    });
    expect(out.plannedInline).toBe(1);
    expect(out.inline).toHaveLength(1);
    expect(out.inline[0]!.slotIndex).toBe(0);
    expect(out.inline[0]!.image.mediaId).toBeGreaterThan(500);

    const { injectPlannedImages } = await import('@content-pilot/core');
    const html = injectPlannedImages(HTML, out.plannedInline, out.inline);
    expect(html).toContain(`wp-image-${out.inline[0]!.image.mediaId}`);
    expect(html.match(/<!-- wp:/g)!.length).toBe(html.match(/<!-- \/wp:/g)!.length);
  });

  it('imagem da fonte oficial (og:image) é usada e leva legenda de crédito', async () => {
    const hero = await noisy(1800, 1000);
    pages.set('https://ign.com/roblox-chat', () =>
      new Response('<html><head><meta property="og:image" content="https://cdn.ign.com/hero.jpg"></head></html>', { headers: { 'content-type': 'text/html' } }),
    );
    pages.set('https://cdn.ign.com/hero.jpg', () => new Response(hero as BodyInit, { headers: { 'content-type': 'image/jpeg' } }));
    const { wp, uploads } = fakeWp();

    const out = await illustratePost({
      ...base, wp, inlineCount: 0,
      sourceUrls: ['https://ign.com/roblox-chat'],
      search: search([]),
      llmVision: vision({ index: 0, alt: 'capa oficial', qualityOk: true, fits: true, reason: 'ok' }),
    });

    expect(out.report.images[0]).toMatchObject({ origin: 'source', sourcePage: 'https://ign.com/roblox-chat' });
    expect(uploads[0]!.caption).toBe('Imagem: ign.com');
  });

  it('format original mantém o tipo do arquivo em vez de converter', async () => {
    const photo = await noisy(2000, 1200);
    pages.set('https://cdn.example/a.jpg', () => new Response(photo as BodyInit, { headers: { 'content-type': 'image/jpeg' } }));
    const { wp, uploads } = fakeWp();
    await illustratePost({
      ...base, wp, inlineCount: 0, format: 'original',
      search: search(['https://cdn.example/a.jpg']),
      llmVision: vision({ index: 0, alt: 'x', qualityOk: true, fits: true, reason: '' }),
    });
    expect(uploads[0]!.mimeType).toBe('image/jpeg');
  });

  it('upload da capa falha: promove a imagem do corpo a capa em vez de ficar sem capa', async () => {
    const gen = imageGen();
    const uploads: string[] = [];
    let n = 0;
    const wp = {
      async uploadMedia(input: CmsMediaUpload) {
        n++;
        uploads.push(input.filename);
        if (n === 1) throw new Error('413 Request Entity Too Large');
        return { id: 700 + n, sourceUrl: `https://blog.example/${input.filename}` };
      },
    } as unknown as CmsAdapter;

    const out = await illustratePost({
      ...base, wp, inlineCount: 1, imageGen: gen,
      search: search([]),
      llmVision: vision({ index: -1, alt: '', qualityOk: false, fits: false, reason: '' }),
    });
    expect(out.coverMissing).toBe(false);
    expect(out.mediaId).toBe(702);
  });
});
