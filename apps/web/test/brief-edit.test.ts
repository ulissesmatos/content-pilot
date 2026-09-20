import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import sharp from 'sharp';
import { createDb } from '@content-pilot/db';
import * as s from '@content-pilot/db';
import {
  genericArticleTemplate,
  gutenbergImageBlock,
  ImageUploadError,
  splitArticle,
  type CmsAdapter,
  type CmsMediaUpload,
  type CmsPost,
  type ImageReport,
} from '@content-pilot/core';

/**
 * Edição do artigo no painel (trocar imagem, ajustar SEO, editar texto) contra Postgres real,
 * pela conexão RESTRITA do cliente, com o WordPress falso e o sharp de verdade.
 */

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) {
  throw new Error('Use TEST_DATABASE_URL apontando para um banco descartavel terminado em _test.');
}
process.env.DATABASE_URL = url;

const db = createDb(url);
const A = randomUUID();
const B = randomUUID();
const ids = { siteA: randomUUID(), tplA: randomUUID(), siteB: randomUUID(), tplB: randomUUID() };

const P = (t: string) => `<!-- wp:paragraph -->\n<p>${t}</p>\n<!-- /wp:paragraph -->`;
const H = (t: string) => `<!-- wp:heading {"level":3} -->\n<h3 class="wp-block-heading">${t}</h3>\n<!-- /wp:heading -->`;
const CONTENT = () =>
  [
    P('Abertura com <a href="https://ign.com/x" target="_blank" rel="noopener">um link</a> e texto.'),
    gutenbergImageBlock({ url: 'https://blog.example/old-902.webp', alt: 'antiga', caption: 'Fonte: IGN', mediaId: 902 }),
    H('Como ativar'),
    P('Segundo parágrafo do artigo.'),
    gutenbergImageBlock({ url: 'https://blog.example/manual-77.webp', alt: 'colada no WP', mediaId: 77 }),
    P('Fecho.'),
  ].join('\n');

interface Fake {
  post: CmsPost;
  uploads: CmsMediaUpload[];
  updates: Array<Record<string, unknown>>;
  mediaUpdates: Array<{ id: number; patch: Record<string, string | undefined> }>;
}
let fake: Fake;
const deps = {
  getWp: async (): Promise<CmsAdapter> =>
    ({
      async getPost() {
        return fake.post;
      },
      async uploadMedia(input: CmsMediaUpload) {
        fake.uploads.push(input);
        const id = 700 + fake.uploads.length;
        return { id, sourceUrl: `https://blog.example/wp-content/uploads/${input.filename}` };
      },
      async updatePost(_id: number, patch: Record<string, unknown>) {
        fake.updates.push(patch);
        if (typeof patch.content === 'string') fake.post = { ...fake.post, contentRaw: patch.content };
        if (typeof patch.title === 'string') fake.post = { ...fake.post, title: patch.title };
        return fake.post;
      },
      async updateMedia(id: number, patch: Record<string, string | undefined>) {
        fake.mediaUpdates.push({ id, patch });
      },
    }) as unknown as CmsAdapter,
};

const report = (): ImageReport => ({
  coverMissing: false,
  plannedInline: 1,
  notes: [],
  images: [
    { slotId: 'cover', role: 'cover', origin: 'search', mediaId: 901, url: 'https://blog.example/old-901.webp', alt: 'capa antiga', width: 1280, height: 720 },
    { slotId: 'inline-1', role: 'inline', origin: 'source', mediaId: 902, url: 'https://blog.example/old-902.webp', alt: 'antiga', caption: 'Fonte: IGN', sourcePage: 'https://ign.com/x' },
  ],
});

async function brief(ws: string, site: string, tpl: string, values: Partial<typeof s.briefs.$inferInsert> = {}) {
  const id = randomUUID();
  await db.insert(s.briefs).values({
    id, workspaceId: ws, siteId: site, templateId: tpl, topic: 'chat do Roblox', status: 'ready_for_review',
    createdWpPostId: 4242, createdWpPostUrl: 'https://blog.example/p/4242', imageReport: report(), ...values,
  });
  return id;
}
const reportOf = async (id: string) => {
  const [row] = await db.select({ r: s.briefs.imageReport }).from(s.briefs).where(s.eq(s.briefs.id, id));
  return row!.r as ImageReport;
};

async function png(width: number, height: number) {
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: { r: 30, g: 90, b: 160 }, noise: { type: 'gaussian', mean: 128, sigma: 40 } } })
      .png()
      .toBuffer(),
  );
}

before(async () => {
  await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../../../packages/db/drizzle') });
  await db.insert(s.workspaces).values([{ id: A, name: 'A' }, { id: B, name: 'B' }]);
  await db.insert(s.sites).values([
    { id: ids.siteA, workspaceId: A, name: 'Site A', baseUrl: 'https://a.example' },
    { id: ids.siteB, workspaceId: B, name: 'Site B', baseUrl: 'https://b.example' },
  ]);
  await db.insert(s.contentTemplates).values([
    { id: ids.tplA, workspaceId: A, slug: `t-${ids.tplA}`, name: 'T', config: genericArticleTemplate.config },
    { id: ids.tplB, workspaceId: B, slug: `t-${ids.tplB}`, name: 'T', config: genericArticleTemplate.config },
  ]);
});

beforeEach(() => {
  fake = {
    post: { id: 4242, title: 'Chat do Roblox', slug: 's', link: 'https://blog.example/p/4242', contentRaw: CONTENT(), usedRenderedFallback: false, featuredMediaId: 901 },
    uploads: [],
    updates: [],
    mediaUpdates: [],
  };
});

after(async () => {
  try {
    await db.execute(s.sql`delete from runs where workspace_id in (${A}::uuid, ${B}::uuid)`);
    await db.execute(s.sql`delete from briefs where workspace_id in (${A}::uuid, ${B}::uuid)`);
    await db.execute(s.sql`delete from content_templates where workspace_id in (${A}::uuid, ${B}::uuid)`);
    await db.execute(s.sql`delete from sites where workspace_id in (${A}::uuid, ${B}::uuid)`);
    await db.execute(s.sql`delete from workspaces where id in (${A}::uuid, ${B}::uuid)`);
  } finally {
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
    await (s.getDb() as unknown as { $client: { end: () => Promise<void> } }).$client.end();
  }
});

const seo = { alt: 'Aba de amigos do Roblox no celular', title: 'Chat do Roblox', caption: 'Imagem: Roblox' };

// ---------- trocar imagem ----------

test('troca a imagem do texto: WebP, SEO no anexo e no bloco, relatório com origem "upload", resto do texto intacto', async () => {
  const { replaceBriefImage } = await import('../src/lib/brief-edit');
  const id = await brief(A, ids.siteA, ids.tplA);
  const source = await png(2000, 1333);
  const r = await replaceBriefImage(A, id, { target: { kind: 'inline', mediaId: 902 }, image: source, seo, filename: 'Minha Foto Nova.PNG' }, deps);

  // arquivo: WebP, nome limpo, muito menor
  assert.equal(fake.uploads.length, 1);
  const up = fake.uploads[0]!;
  assert.equal(up.mimeType, 'image/webp');
  assert.equal(up.filename, 'minha-foto-nova.webp');
  assert.equal((await sharp(up.data).metadata()).format, 'webp');
  assert.ok(up.data.byteLength < source.byteLength / 3);
  assert.deepEqual([up.alt, up.title, up.caption], [seo.alt, seo.title, seo.caption]);
  assert.equal(r.fileName, 'minha-foto-nova.webp');
  assert.equal(r.bytes, up.data.byteLength);

  // post: só a imagem 902 mudou; o novo bloco carrega o SEO
  assert.equal(fake.updates.length, 1);
  const html = fake.updates[0]!.content as string;
  assert.ok(!html.includes('wp-image-902') && !html.includes('old-902'));
  const imgs = splitArticle(html).filter((x) => x.kind === 'image') as Array<{ mediaId: number; alt: string; caption: string }>;
  assert.deepEqual(imgs.map((i) => i.mediaId), [701, 77]);
  assert.equal(imgs[0]!.alt, seo.alt);
  assert.equal(imgs[0]!.caption, seo.caption);
  assert.ok(html.includes('Segundo parágrafo do artigo.') && html.includes('colada no WP'));

  // relatório: mesmo slot, origem "upload", sem a página de origem da imagem antiga
  const rep = await reportOf(id);
  const item = rep.images.find((i) => i.slotId === 'inline-1')!;
  assert.equal(item.origin, 'upload');
  assert.equal(item.mediaId, 701);
  assert.equal(item.sourcePage, undefined);
  assert.equal(rep.images.find((i) => i.slotId === 'cover')!.mediaId, 901); // a capa não foi tocada
});

test('troca a capa: recorte exato de 1280x720 e a imagem destacada do post muda', async () => {
  const { replaceBriefImage } = await import('../src/lib/brief-edit');
  const id = await brief(A, ids.siteA, ids.tplA);
  const r = await replaceBriefImage(A, id, { target: { kind: 'cover' }, image: await png(1400, 2400), seo }, deps);
  const meta = await sharp(fake.uploads[0]!.data).metadata();
  assert.deepEqual([meta.width, meta.height], [1280, 720]);
  assert.deepEqual(fake.updates, [{ featuredMediaId: 701 }]);
  assert.equal(r.upscaled, false);
  assert.equal((await reportOf(id)).images.find((i) => i.slotId === 'cover')!.origin, 'upload');
  // sem nome informado, o arquivo nasce do alt
  assert.equal(fake.uploads[0]!.filename, 'aba-de-amigos-do-roblox-no-celular.webp');
});

test('imagem que o usuário colou direto no WordPress (fora do relatório) também pode ser trocada', async () => {
  const { replaceBriefImage } = await import('../src/lib/brief-edit');
  const id = await brief(A, ids.siteA, ids.tplA);
  await replaceBriefImage(A, id, { target: { kind: 'inline', mediaId: 77 }, image: await png(900, 600), seo }, deps);
  const rep = await reportOf(id);
  assert.ok(rep.images.some((i) => i.slotId === 'inline-u701' && i.origin === 'upload'));
});

test('arquivo que não é imagem é recusado ANTES de mexer no WordPress', async () => {
  const { replaceBriefImage } = await import('../src/lib/brief-edit');
  const id = await brief(A, ids.siteA, ids.tplA);
  await assert.rejects(
    replaceBriefImage(A, id, { target: { kind: 'cover' }, image: new TextEncoder().encode('não sou uma imagem'), seo }, deps),
    (e: unknown) => e instanceof ImageUploadError && e.code === 'invalid',
  );
  assert.equal(fake.uploads.length, 0);
  assert.equal(fake.updates.length, 0);
  assert.deepEqual(await reportOf(id), report());
});

test('imagem que saiu do post no WordPress: recusa sem enviar nada', async () => {
  const { replaceBriefImage } = await import('../src/lib/brief-edit');
  const id = await brief(A, ids.siteA, ids.tplA);
  fake.post = { ...fake.post, contentRaw: P('Só texto agora.') };
  await assert.rejects(
    replaceBriefImage(A, id, { target: { kind: 'inline', mediaId: 902 }, image: await png(900, 600), seo }, deps),
    (e: unknown) => (e as { code?: string }).code === 'gone',
  );
  assert.equal(fake.uploads.length, 0);
});

test('sem permissão de edição no WordPress (só HTML renderizado), a imagem do texto não é trocada', async () => {
  const { replaceBriefImage } = await import('../src/lib/brief-edit');
  const id = await brief(A, ids.siteA, ids.tplA);
  fake.post = { ...fake.post, usedRenderedFallback: true };
  await assert.rejects(replaceBriefImage(A, id, { target: { kind: 'inline', mediaId: 902 }, image: await png(900, 600), seo }, deps), /permissão de edição/);
  assert.equal(fake.uploads.length, 0);
});

test('durante uma troca por IA do mesmo artigo, a edição manual espera (as duas leriam o mesmo HTML)', async () => {
  const { replaceBriefImage, saveBriefText } = await import('../src/lib/brief-edit');
  const id = await brief(A, ids.siteA, ids.tplA);
  await db.insert(s.runs).values({ workspaceId: A, briefId: id, kind: 'update', trigger: 'manual', status: 'running' });
  await assert.rejects(replaceBriefImage(A, id, { target: { kind: 'cover' }, image: await png(900, 600), seo }, deps), (e: unknown) => (e as { code?: string }).code === 'busy');
  await assert.rejects(saveBriefText(A, id, { edits: [] }, deps), (e: unknown) => (e as { code?: string }).code === 'busy');
  assert.equal(fake.uploads.length, 0);
});

test('artigo ainda não criado, e o de outro cliente: recusados como se não existissem', async () => {
  const { replaceBriefImage } = await import('../src/lib/brief-edit');
  const pending = await brief(A, ids.siteA, ids.tplA, { status: 'pending', createdWpPostId: null, createdWpPostUrl: null });
  await assert.rejects(replaceBriefImage(A, pending, { target: { kind: 'cover' }, image: await png(900, 600), seo }, deps), /criado no WordPress/);
  const mine = await brief(A, ids.siteA, ids.tplA);
  await assert.rejects(
    replaceBriefImage(B, mine, { target: { kind: 'cover' }, image: await png(900, 600), seo }, deps),
    (e: unknown) => (e as { code?: string }).code === 'not_found',
  );
  assert.equal(fake.uploads.length, 0);
});

// ---------- SEO ----------

test('ajusta só o SEO de uma imagem do texto: bloco e anexo, sem trocar o arquivo', async () => {
  const { updateBriefImageSeo } = await import('../src/lib/brief-edit');
  const id = await brief(A, ids.siteA, ids.tplA);
  await updateBriefImageSeo(A, id, { target: { kind: 'inline', mediaId: 902 }, seo }, deps);
  assert.equal(fake.uploads.length, 0);
  assert.deepEqual(fake.mediaUpdates, [{ id: 902, patch: { alt: seo.alt, caption: seo.caption, title: seo.title } }]);
  const img = splitArticle(fake.updates[0]!.content as string).find((x) => x.kind === 'image' && x.mediaId === 902) as { url: string; alt: string };
  assert.equal(img.url, 'https://blog.example/old-902.webp'); // mesmo arquivo
  assert.equal(img.alt, seo.alt);
  const item = (await reportOf(id)).images.find((i) => i.mediaId === 902)!;
  assert.equal(item.alt, seo.alt);
  assert.equal(item.origin, 'source'); // continua sendo a imagem da fonte
});

test('SEO da capa: vale o anexo que o WordPress diz ser a imagem destacada, e o texto não é tocado', async () => {
  const { updateBriefImageSeo } = await import('../src/lib/brief-edit');
  const id = await brief(A, ids.siteA, ids.tplA);
  fake.post = { ...fake.post, featuredMediaId: 555 };
  await updateBriefImageSeo(A, id, { target: { kind: 'cover' }, seo }, deps);
  assert.equal(fake.updates.length, 0);
  assert.equal(fake.mediaUpdates[0]!.id, 555);
});

// ---------- texto ----------

test('edita parágrafo, título de seção e o título do artigo; o resto do HTML fica idêntico', async () => {
  const { saveBriefText } = await import('../src/lib/brief-edit');
  const id = await brief(A, ids.siteA, ids.tplA);
  const before = fake.post.contentRaw;
  const r = await saveBriefText(
    A,
    id,
    {
      title: 'Como ativar o chat do Roblox',
      edits: [
        { index: 2, beforeText: 'Segundo parágrafo do artigo.', afterHtml: 'Segundo parágrafo, agora com <strong>destaque</strong>.' },
        { index: 1, beforeText: 'Como ativar', afterHtml: 'Como ativar o chat' },
      ],
    },
    deps,
  );
  assert.deepEqual(r, { changed: 2, titleChanged: true });
  assert.equal(fake.updates.length, 1); // um único envio ao WordPress
  const html = fake.updates[0]!.content as string;
  assert.ok(html.includes('<p>Segundo parágrafo, agora com <strong>destaque</strong>.</p>'));
  assert.ok(html.includes('>Como ativar o chat</h3>'));
  assert.equal(fake.updates[0]!.title, 'Como ativar o chat do Roblox');
  // todo o resto (link, imagens, fecho) intacto
  assert.equal(html.replace('Segundo parágrafo, agora com <strong>destaque</strong>.', 'Segundo parágrafo do artigo.').replace('Como ativar o chat<', 'Como ativar<'), before);
});

test('o que o navegador enfia ao editar é limpo: div, span com estilo, script, nbsp; link seguro fica, javascript: sai', async () => {
  const { saveBriefText } = await import('../src/lib/brief-edit');
  const id = await brief(A, ids.siteA, ids.tplA);
  await saveBriefText(
    A,
    id,
    {
      edits: [
        {
          index: 0,
          beforeText: 'Abertura com um link e texto.',
          afterHtml:
            '<div>Nova&nbsp;abertura</div> <span style="color:red" onclick="x()">colorida</span> <script>alert(1)</script>' +
            '<a href="https://ign.com/x" target="_blank" rel="noopener">um link</a> <a href="javascript:alert(1)">ruim</a>',
        },
      ],
    },
    deps,
  );
  const html = fake.updates[0]!.content as string;
  assert.ok(!/<div|<span|<script|onclick|style=|javascript:|&nbsp;/i.test(html), html);
  assert.ok(html.includes('href="https://ign.com/x"'));
  assert.ok(html.includes('Nova abertura'));
});

test('quebra de linha só em parágrafo: em título de seção o <br> some', async () => {
  const { saveBriefText } = await import('../src/lib/brief-edit');
  const id = await brief(A, ids.siteA, ids.tplA);
  await saveBriefText(A, id, { edits: [{ index: 1, beforeText: 'Como ativar', afterHtml: 'Como<br>ativar' }] }, deps);
  assert.ok(!(fake.updates[0]!.content as string).includes('<br'));
});

test('se o WordPress mudou o trecho enquanto o usuário editava, NADA é gravado', async () => {
  const { saveBriefText } = await import('../src/lib/brief-edit');
  const id = await brief(A, ids.siteA, ids.tplA);
  await assert.rejects(
    saveBriefText(
      A,
      id,
      {
        title: 'Título novo que não pode ser gravado',
        edits: [
          { index: 3, beforeText: 'Fecho.', afterHtml: 'Fecho novo.' },
          { index: 2, beforeText: 'Segundo parágrafo ANTIGO que ninguém mais tem.', afterHtml: 'X' },
        ],
      },
      deps,
    ),
    (e: unknown) => (e as { code?: string }).code === 'conflict',
  );
  assert.equal(fake.updates.length, 0);
});

test('trecho esvaziado é recusado; título curto demais também; sem mudança real não envia nada', async () => {
  const { saveBriefText } = await import('../src/lib/brief-edit');
  const id = await brief(A, ids.siteA, ids.tplA);
  await assert.rejects(saveBriefText(A, id, { edits: [{ index: 3, beforeText: 'Fecho.', afterHtml: '<b> </b>' }] }, deps), (e: unknown) => (e as { code?: string }).code === 'empty');
  await assert.rejects(saveBriefText(A, id, { title: 'ab', edits: [] }, deps), /entre 3 e/);
  assert.deepEqual(await saveBriefText(A, id, { title: 'Chat do Roblox', edits: [{ index: 3, beforeText: 'Fecho.', afterHtml: 'Fecho.' }] }, deps), { changed: 0, titleChanged: false });
  assert.equal(fake.updates.length, 0);
});

test('imagem da web: só http(s), e nunca rede interna', async () => {
  const { downloadRemoteImage } = await import('../src/lib/brief-edit');
  await assert.rejects(downloadRemoteImage('file:///etc/passwd'), /http/);
  await assert.rejects(downloadRemoteImage('javascript:alert(1)'), /http|válido/);
  await assert.rejects(downloadRemoteImage('não é url'), /válido/);
  // endereço de rede interna (metadados de nuvem, localhost): bloqueado pelo fetch público
  await assert.rejects(downloadRemoteImage('http://169.254.169.254/latest/meta-data/'), /baixar/);
  await assert.rejects(downloadRemoteImage('http://127.0.0.1:5432/'), /baixar/);
});
