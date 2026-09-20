import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from '@content-pilot/db';
import * as s from '@content-pilot/db';
import type { ArticleSegment } from '@content-pilot/core';

/**
 * Dados da tela de preview contra Postgres real, pela conexão RESTRITA do cliente
 * (getTenantDb): a pauta de um cliente nunca aparece para outro, os relatórios
 * gravados em jsonb são lidos sem confiar no formato, e o texto do artigo passa
 * pelo sanitizador antes de chegar à tela.
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

async function brief(ws: string, site: string, tpl: string, values: Partial<typeof s.briefs.$inferInsert>) {
  const id = randomUUID();
  await db.insert(s.briefs).values({ id, workspaceId: ws, siteId: site, templateId: tpl, topic: 'Tema', ...values });
  return id;
}

before(async () => {
  await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../../../packages/db/drizzle') });
  await db.insert(s.workspaces).values([{ id: A, name: 'A' }, { id: B, name: 'B' }]);
  await db.insert(s.sites).values([
    { id: ids.siteA, workspaceId: A, name: 'Site A', baseUrl: 'https://a.example' },
    { id: ids.siteB, workspaceId: B, name: 'Site B', baseUrl: 'https://b.example' },
  ]);
  await db.insert(s.contentTemplates).values([
    { id: ids.tplA, workspaceId: A, slug: `t-${ids.tplA}`, name: 'Modelo A', config: {} },
    { id: ids.tplB, workspaceId: B, slug: `t-${ids.tplB}`, name: 'Modelo B', config: {} },
  ]);
});

after(async () => {
  try {
    await db.execute(s.sql`delete from briefs where workspace_id in (${A}::uuid, ${B}::uuid)`);
    await db.execute(s.sql`delete from content_templates where workspace_id in (${A}::uuid, ${B}::uuid)`);
    await db.execute(s.sql`delete from sites where workspace_id in (${A}::uuid, ${B}::uuid)`);
    await db.execute(s.sql`delete from workspaces where id in (${A}::uuid, ${B}::uuid)`);
  } finally {
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
    await (s.getDb() as unknown as { $client: { end: () => Promise<void> } }).$client.end();
  }
});

test('carrega a pauta com os nomes e lê os relatórios gravados, sem chamar o WordPress quando não há post', async () => {
  const { loadBriefPreview } = await import('../src/lib/brief-preview');
  const id = await brief(A, ids.siteA, ids.tplA, {
    status: 'failed',
    error: 'sem chave',
    imageReport: {
      coverMissing: true,
      plannedInline: 2,
      images: [{ slotId: 'inline-1', role: 'inline', origin: 'source', mediaId: 5, url: 'https://a.example/i.webp', alt: 'x' }, { lixo: true }],
      notes: ['cover: sem imagem'],
    },
    editorialReport: {
      review: { status: 'revised', changes: [{ kind: 'dull', section: 'Intro', note: 'mais direto' }], reason: null, remainingTells: [] },
      embeds: [],
      embedNotes: [],
    },
  });

  const p = await loadBriefPreview(A, id);
  assert.ok(p);
  assert.equal(p.siteName, 'Site A');
  assert.equal(p.templateName, 'Modelo A');
  assert.equal(p.post, null);
  assert.equal(p.postError, null);
  assert.equal(p.images.coverMissing, true);
  assert.equal(p.images.images.length, 1); // o item torto foi descartado
  assert.equal(p.editorial?.review?.changes[0]?.note, 'mais direto');
});

test('posts antigos, sem relatórios, abrem normalmente', async () => {
  const { loadBriefPreview } = await import('../src/lib/brief-preview');
  const id = await brief(A, ids.siteA, ids.tplA, { status: 'pending' });
  const p = await loadBriefPreview(A, id);
  assert.ok(p);
  assert.deepEqual(p.images.images, []);
  assert.equal(p.editorial, null);
});

test('a pauta de outro cliente é invisível: null, como um id que não existe', async () => {
  const { loadBriefPreview } = await import('../src/lib/brief-preview');
  const id = await brief(A, ids.siteA, ids.tplA, { topic: 'Confidencial do A' });
  assert.equal(await loadBriefPreview(B, id), null);
  assert.equal(await loadBriefPreview(B, randomUUID()), null);
  assert.ok(await loadBriefPreview(A, id));
});

test('post com credencial do WordPress inexistente: o erro vira aviso na tela, não derruba a página', async () => {
  const { loadBriefPreview } = await import('../src/lib/brief-preview');
  // o site não tem credencial: getWordPressForSite lança, e a tela precisa seguir com os relatórios
  const id = await brief(A, ids.siteA, ids.tplA, {
    status: 'ready_for_review',
    createdWpPostId: 77,
    createdWpPostUrl: 'https://a.example/p/77',
    imageReport: { coverMissing: false, plannedInline: 0, images: [], notes: [] },
  });
  const p = await loadBriefPreview(A, id);
  assert.ok(p);
  assert.equal(p.post, null);
  assert.match(p.postError ?? '', /credencial/i);
});

test('o texto passa pelo sanitizador: script some, imagem não-http some, embed do YouTube fica', async () => {
  const { toSafeSegments } = await import('../src/lib/brief-preview');
  const input: ArticleSegment[] = [
    { kind: 'html', html: '<p onclick="x()">oi</p><script>alert(1)</script>' },
    { kind: 'html', html: '<!-- wp:paragraph -->' }, // só comentário: vira nada
    { kind: 'image', mediaId: 1, url: 'javascript:alert(1)', alt: '', caption: '' },
    { kind: 'image', mediaId: 2, url: 'https://a.example/ok.webp', alt: 'ok', caption: '' },
    { kind: 'embed', provider: 'youtube', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', id: 'aaaaaaaaaaa' },
    { kind: 'embed', provider: 'other', url: 'javascript:alert(1)', id: null },
  ];
  const out = toSafeSegments(input);
  assert.deepEqual(out.map((x) => x.kind), ['html', 'image', 'embed']);
  const html = (out[0] as { html: string }).html;
  assert.ok(!/script|onclick/i.test(html), html);
  assert.equal((out[1] as { mediaId: number }).mediaId, 2);
});
