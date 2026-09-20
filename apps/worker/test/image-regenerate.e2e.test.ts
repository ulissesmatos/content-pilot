import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import sharp from 'sharp';
import type { CmsAdapter, CmsMediaUpload, CmsPost, ImageGenClient, ImageReport } from '@content-pilot/core';

/**
 * Ponta a ponta de `handleImageRegenerate`: pede-se uma imagem nova de um artigo já
 * criado e o handler gera, converte para WebP, envia ao WordPress e troca no post.
 * Postgres, conversão (sharp), troca no HTML e relatório são código REAL; só o
 * WordPress e o gerador de imagem são falsos.
 */

const url = process.env.TEST_DATABASE_URL;
const enabled = Boolean(url && new URL(url).pathname.endsWith('_test'));
if (enabled) process.env.DATABASE_URL = url;
process.env.ADMIN_EMAIL = 'owner@example.test';

interface World {
  imageGen: ImageGenClient | null;
  prompts: string[];
  post: CmsPost;
  uploads: CmsMediaUpload[];
  updates: Array<{ id: number; patch: Record<string, unknown> }>;
}
const world: World = {
  imageGen: null,
  prompts: [],
  post: { id: 4242, title: 'Chat do Roblox', slug: 's', link: 'https://blog.example/p/4242', contentRaw: '', usedRenderedFallback: false },
  uploads: [],
  updates: [],
};

vi.mock('../src/lib/resolve', async () => {
  const { parseTemplateConfig, genericArticleTemplate } = await import('@content-pilot/core');
  return {
    resolveImageGenProvider: async () => world.imageGen,
    resolveTemplateById: async () => ({
      id: 'tpl',
      slug: 'generic-article',
      config: parseTemplateConfig(genericArticleTemplate.config),
    }),
    resolveWordPressAdapter: async (): Promise<CmsAdapter> =>
      ({
        async getPost() {
          return world.post;
        },
        async uploadMedia(input: CmsMediaUpload) {
          world.uploads.push(input);
          const id = 700 + world.uploads.length;
          return { id, sourceUrl: `https://blog.example/wp-content/uploads/${input.filename}` };
        },
        async updatePost(id: number, patch: Record<string, unknown>) {
          world.updates.push({ id, patch });
          return world.post;
        },
      }) as unknown as CmsAdapter,
  };
});

const P = (t: string) => `<!-- wp:paragraph --><p>${t}</p><!-- /wp:paragraph -->`;
const img = (id: number) =>
  `<!-- wp:image {"id":${id},"sizeSlug":"large","linkDestination":"none"} -->` +
  `<figure class="wp-block-image size-large"><img src="https://blog.example/old-${id}.webp" alt="antiga ${id}" class="wp-image-${id}"/></figure>` +
  `<!-- /wp:image -->`;
const POST_HTML = [P('Primeiro parágrafo do artigo.'), img(902), P('Segundo parágrafo do artigo.')].join('\n');

const report = (over: Partial<ImageReport> = {}): ImageReport => ({
  coverMissing: false,
  plannedInline: 1,
  notes: [],
  images: [
    { slotId: 'cover', role: 'cover', origin: 'search', mediaId: 901, url: 'https://blog.example/old-901.webp', alt: 'capa antiga', width: 1280, height: 720 },
    { slotId: 'inline-1', role: 'inline', origin: 'source', mediaId: 902, url: 'https://blog.example/old-902.webp', alt: 'antiga 902', sourcePage: 'https://ign.com/x' },
  ],
  ...over,
});

let dbMod: typeof import('@content-pilot/db');
let handle: typeof import('../src/queues/image-regenerate').handleImageRegenerate;
let db: import('@content-pilot/db').Db;
const ws = randomUUID();
const siteId = randomUUID();
const templateId = randomUUID();

async function newBrief(imageReport: ImageReport | null, status: 'ready_for_review' | 'published' = 'ready_for_review') {
  const briefId = randomUUID();
  const runId = randomUUID();
  await db.insert(dbMod.briefs).values({
    id: briefId, workspaceId: ws, siteId, templateId, topic: 'chat do Roblox', status,
    createdWpPostId: 4242, createdWpPostUrl: 'https://blog.example/p/4242', imageReport,
  });
  await db.insert(dbMod.runs).values({ id: runId, workspaceId: ws, briefId, kind: 'update', trigger: 'manual', status: 'running' });
  return { briefId, runId };
}

async function generated() {
  return {
    data: new Uint8Array(
      await sharp({ create: { width: 1536, height: 1024, channels: 3, background: { r: 30, g: 90, b: 160 }, noise: { type: 'gaussian', mean: 128, sigma: 40 } } })
        .png()
        .toBuffer(),
    ),
    mimeType: 'image/png',
  };
}

const describeIf = enabled ? describe : describe.skip;

describeIf('handleImageRegenerate (Postgres real, WordPress e gerador falsos)', () => {
  beforeAll(async () => {
    dbMod = await import('@content-pilot/db');
    db = dbMod.createDb(url);
    await dbMod.migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../../../packages/db/drizzle') });
    ({ handleImageRegenerate: handle } = await import('../src/queues/image-regenerate'));
    await db.insert(dbMod.workspaces).values({ id: ws, name: 'REGEN' });
    await db.insert(dbMod.sites).values({ id: siteId, workspaceId: ws, name: 'Blog', baseUrl: 'https://blog.example' });
    await db.insert(dbMod.contentTemplates).values({ id: templateId, workspaceId: ws, slug: `t-${templateId}`, name: 'T', config: {} });
  });

  afterAll(async () => {
    if (!db) return;
    await db.execute(dbMod.sql`delete from run_logs where run_id in (select id from runs where workspace_id = ${ws}::uuid)`);
    for (const t of ['run_items', 'runs', 'briefs', 'sites', 'content_templates']) {
      await db.execute(dbMod.sql`delete from ${dbMod.sql.identifier(t)} where workspace_id = ${ws}::uuid`);
    }
    await db.execute(dbMod.sql`delete from workspaces where id = ${ws}::uuid`);
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
  });

  beforeEach(async () => {
    world.prompts = [];
    world.uploads = [];
    world.updates = [];
    world.post = { ...world.post, contentRaw: POST_HTML, usedRenderedFallback: false };
    world.imageGen = {
      async generate(prompt) {
        world.prompts.push(prompt);
        return generated();
      },
    };
  });

  const state = async (briefId: string, runId: string) => {
    const [brief] = await db.select().from(dbMod.briefs).where(dbMod.eq(dbMod.briefs.id, briefId));
    const [run] = await db.select().from(dbMod.runs).where(dbMod.eq(dbMod.runs.id, runId));
    const items = await db.select().from(dbMod.runItems).where(dbMod.eq(dbMod.runItems.runId, runId));
    return { brief: brief!, run: run!, items };
  };

  it('troca a imagem do corpo: WebP no tamanho do slot, HTML atualizado no lugar, relatório e run fechados', async () => {
    const { briefId, runId } = await newBrief(report());
    await handle(db, { briefId, runId, slotId: 'inline-1', instruction: 'o aplicativo aberto na tela de chat' });

    // o pedido do usuário chegou ao gerador
    expect(world.prompts).toHaveLength(1);
    expect(world.prompts[0]).toContain('o aplicativo aberto na tela de chat');

    // enviada como WebP
    expect(world.uploads).toHaveLength(1);
    expect(world.uploads[0]!.mimeType).toBe('image/webp');
    expect(world.uploads[0]!.filename).toMatch(/\.webp$/);

    // o post foi atualizado uma vez: só o corpo, com a imagem nova no lugar da antiga
    expect(world.updates).toHaveLength(1);
    const patch = world.updates[0]!.patch as { content: string; featuredMediaId?: number };
    expect(patch.featuredMediaId).toBeUndefined();
    expect(patch.content).toContain('wp-image-701');
    expect(patch.content).not.toContain('wp-image-902');
    expect(patch.content).not.toContain('old-902');
    expect(patch.content).toContain('Primeiro parágrafo do artigo.');
    expect(patch.content).toContain('Segundo parágrafo do artigo.');

    const { brief, run, items } = await state(briefId, runId);
    const r = brief.imageReport as ImageReport;
    expect(r.images.find((i) => i.slotId === 'inline-1')).toMatchObject({ origin: 'generated', mediaId: 701 });
    // a capa não foi tocada
    expect(r.images.find((i) => i.slotId === 'cover')).toMatchObject({ origin: 'search', mediaId: 901 });
    expect(brief.status).toBe('ready_for_review');
    expect(run.status).toBe('success');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ status: 'updated', action: 'regenerate_image' });
  });

  it('troca a capa: define a imagem destacada e não mexe no texto do post', async () => {
    const { briefId, runId } = await newBrief(report());
    await handle(db, { briefId, runId, slotId: 'cover' });

    expect(world.updates).toHaveLength(1);
    expect(world.updates[0]!.patch).toEqual({ featuredMediaId: 701 });
    // capa é recortada no tamanho exato do template (1280x720)
    const meta = await sharp(world.uploads[0]!.data).metadata();
    expect([meta.width, meta.height]).toEqual([1280, 720]);
    expect(world.prompts[0]).toContain('cover image');

    const { brief } = await state(briefId, runId);
    const r = brief.imageReport as ImageReport;
    expect(r.images.find((i) => i.slotId === 'cover')).toMatchObject({ origin: 'generated', mediaId: 701 });
  });

  it('gera a capa que faltou: o relatório deixa de dizer "sem capa"', async () => {
    const { briefId, runId } = await newBrief(report({ coverMissing: true, images: report().images.filter((i) => i.role === 'inline') }));
    await handle(db, { briefId, runId, slotId: 'cover' });

    const { brief, run } = await state(briefId, runId);
    const r = brief.imageReport as ImageReport;
    expect(r.coverMissing).toBe(false);
    expect(r.images[0]).toMatchObject({ slotId: 'cover', origin: 'generated' });
    expect(run.status).toBe('success');
  });

  it('sem gerador de imagem: falha com mensagem clara, sem enviar nem alterar nada', async () => {
    world.imageGen = null;
    const { briefId, runId } = await newBrief(report());
    await handle(db, { briefId, runId, slotId: 'inline-1' });

    expect(world.uploads).toHaveLength(0);
    expect(world.updates).toHaveLength(0);
    const { brief, run, items } = await state(briefId, runId);
    expect(run.status).toBe('failed');
    expect(items[0]).toMatchObject({ status: 'failed' });
    expect(items[0]!.changesSummary).toContain('gerador de imagem');
    // o artigo continua como estava
    expect(brief.status).toBe('ready_for_review');
    expect(brief.imageReport).toEqual(report());
  });

  it('imagem que saiu do post no WordPress: falha ANTES de gastar uma geração', async () => {
    world.post = { ...world.post, contentRaw: [P('Só texto agora.'), P('Sem imagem nenhuma.')].join('\n') };
    const { briefId, runId } = await newBrief(report());
    await handle(db, { briefId, runId, slotId: 'inline-1' });

    expect(world.prompts).toHaveLength(0); // não gerou, não cobrou
    expect(world.uploads).toHaveLength(0);
    expect(world.updates).toHaveLength(0);
    const { run, items } = await state(briefId, runId);
    expect(run.status).toBe('failed');
    expect(items[0]!.changesSummary).toContain('não está mais no post');
  });

  it('sem permissão de edição (só HTML renderizado): não troca imagem do corpo', async () => {
    world.post = { ...world.post, usedRenderedFallback: true };
    const { briefId, runId } = await newBrief(report());
    await handle(db, { briefId, runId, slotId: 'inline-1' });

    expect(world.prompts).toHaveLength(0);
    expect(world.updates).toHaveLength(0);
    const { items } = await state(briefId, runId);
    expect(items[0]!.changesSummary).toContain('permissão de edição');
  });

  it('slot que não existe no relatório é recusado', async () => {
    const { briefId, runId } = await newBrief(report());
    await handle(db, { briefId, runId, slotId: 'inline-9' });
    expect(world.prompts).toHaveLength(0);
    const { run, items } = await state(briefId, runId);
    expect(run.status).toBe('failed');
    expect(items[0]!.changesSummary).toContain('inline-9');
  });

  it('run que não está mais em execução (cancelado) é ignorado sem tocar em nada', async () => {
    const { briefId, runId } = await newBrief(report());
    await db.update(dbMod.runs).set({ status: 'cancelled' }).where(dbMod.eq(dbMod.runs.id, runId));
    await handle(db, { briefId, runId, slotId: 'cover' });
    expect(world.prompts).toHaveLength(0);
    expect(world.updates).toHaveLength(0);
    expect((await state(briefId, runId)).items).toHaveLength(0);
  });
});
