import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from '@content-pilot/db';
import * as s from '@content-pilot/db';
import { stageMarker } from '@content-pilot/core';

/**
 * Progresso de execução contra Postgres real, pela conexão RESTRITA do cliente
 * (getTenantDb), a mesma que o endpoint usa. Prova três coisas: a descoberta é
 * seguida até os posts que ela gerou, o "terminou?" espera os runs filhos, e um
 * cliente nunca enxerga logs de outro.
 */

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) {
  throw new Error('Use TEST_DATABASE_URL apontando para um banco descartavel terminado em _test.');
}
process.env.DATABASE_URL = url;

const db = createDb(url);
const A = randomUUID();
const B = randomUUID();
const ids = {
  siteA: randomUUID(), tplA: randomUUID(), cfgA: randomUUID(),
  siteB: randomUUID(), tplB: randomUUID(),
};

async function brief(ws: string, site: string, tpl: string, topic: string, status = 'generating', wpUrl?: string) {
  const id = randomUUID();
  await db.insert(s.briefs).values({
    id, workspaceId: ws, siteId: site, templateId: tpl, topic, status: status as never, createdWpPostUrl: wpUrl ?? null,
  });
  return id;
}
async function run(ws: string, values: Partial<typeof s.runs.$inferInsert>) {
  const id = randomUUID();
  await db.insert(s.runs).values({ id, workspaceId: ws, trigger: 'manual', status: 'running', ...values });
  return id;
}
async function logs(runId: string, lines: string[]) {
  const base = Date.now();
  await db.insert(s.runLogs).values(lines.map((line, i) => ({ runId, ts: new Date(base + i * 1000), line })));
}

before(async () => {
  await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../../../packages/db/drizzle') });
  await db.insert(s.workspaces).values([{ id: A, name: 'A' }, { id: B, name: 'B' }]);
  await db.insert(s.sites).values([
    { id: ids.siteA, workspaceId: A, name: 'SA', baseUrl: 'https://a.example' },
    { id: ids.siteB, workspaceId: B, name: 'SB', baseUrl: 'https://b.example' },
  ]);
  await db.insert(s.contentTemplates).values([
    { id: ids.tplA, workspaceId: A, slug: `t-${ids.tplA}`, name: 'T', config: {} },
    { id: ids.tplB, workspaceId: B, slug: `t-${ids.tplB}`, name: 'T', config: {} },
  ]);
  await db.insert(s.autopilotConfigs).values({
    id: ids.cfgA, workspaceId: A, siteId: ids.siteA, templateId: ids.tplA, name: 'AP', seedTopics: ['x'],
    scheduleCron: '0 * * * *', discovery: {}, llmConfig: {}, limits: {},
  });
});

after(async () => {
  try {
    await db.execute(s.sql`delete from discovered_topics where workspace_id in (${A}::uuid, ${B}::uuid)`);
    await db.execute(s.sql`delete from runs where workspace_id in (${A}::uuid, ${B}::uuid)`);
    await db.execute(s.sql`delete from briefs where workspace_id in (${A}::uuid, ${B}::uuid)`);
    await db.execute(s.sql`delete from autopilot_configs where workspace_id in (${A}::uuid, ${B}::uuid)`);
    await db.execute(s.sql`delete from content_templates where workspace_id in (${A}::uuid, ${B}::uuid)`);
    await db.execute(s.sql`delete from sites where workspace_id in (${A}::uuid, ${B}::uuid)`);
    await db.execute(s.sql`delete from workspaces where id in (${A}::uuid, ${B}::uuid)`);
  } finally {
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
    await (s.getDb() as unknown as { $client: { end: () => Promise<void> } }).$client.end();
  }
});

test('um run de criação acompanha as próprias etapas e o link do post', async () => {
  const { getRunProgress } = await import('../src/lib/run-progress');
  const briefId = await brief(A, ids.siteA, ids.tplA, 'Tema criação', 'ready_for_review', 'https://a.example/p/1');
  const runId = await run(A, { kind: 'create', briefId, status: 'success' });
  await logs(runId, [
    stageMarker('pesquisa'), 'busca [main] (advanced): x', stageMarker('redacao'), stageMarker('imagens'), stageMarker('publicacao'),
    'post #1 criado (draft) em 30.0s',
  ]);

  const p = await getRunProgress(A, runId);
  assert.ok(p);
  assert.equal(p.run.kind, 'create');
  assert.equal(p.done, true);
  assert.deepEqual(p.stages.map((x) => `${x.key}:${x.status}`), [
    'pesquisa:done', 'redacao:done', 'revisao:skipped', 'imagens:done', 'embeds:skipped', 'publicacao:done',
  ]);
  assert.equal(p.posts.length, 1);
  assert.equal(p.posts[0]!.briefId, briefId);
  assert.equal(p.posts[0]!.wpUrl, 'https://a.example/p/1');
  assert.equal(p.posts[0]!.briefStatus, 'ready_for_review');
  assert.ok(p.logs.length >= 5);
});

test('a descoberta é seguida até os posts que ela gerou, e só termina quando os filhos terminam', async () => {
  const { getRunProgress } = await import('../src/lib/run-progress');
  const discover = await run(A, { kind: 'discover', trigger: 'manual', status: 'success', autopilotConfigId: ids.cfgA });
  await logs(discover, [stageMarker('descoberta'), 'descoberta [busca]: x']);

  const b1 = await brief(A, ids.siteA, ids.tplA, 'Pauta em geração');
  const b2 = await brief(A, ids.siteA, ids.tplA, 'Pauta pronta', 'ready_for_review', 'https://a.example/p/2');
  const b3 = await brief(A, ids.siteA, ids.tplA, 'Pauta sem geração automática', 'pending');
  await db.insert(s.discoveredTopics).values([
    { workspaceId: A, autopilotConfigId: ids.cfgA, runId: discover, topic: 'Pauta em geração', contentType: 'evergreen', status: 'queued', briefId: b1 },
    { workspaceId: A, autopilotConfigId: ids.cfgA, runId: discover, topic: 'Pauta pronta', contentType: 'evergreen', status: 'queued', briefId: b2 },
    { workspaceId: A, autopilotConfigId: ids.cfgA, runId: discover, topic: 'Pauta sem geração automática', contentType: 'evergreen', status: 'pending', briefId: b3 },
    { workspaceId: A, autopilotConfigId: ids.cfgA, runId: discover, topic: 'Descartado', contentType: 'evergreen', status: 'discarded_duplicate' },
  ]);
  const child1 = await run(A, { kind: 'create', trigger: 'autopilot', briefId: b1, autopilotConfigId: ids.cfgA });
  await logs(child1, [stageMarker('pesquisa'), stageMarker('redacao')]);
  const child2 = await run(A, { kind: 'create', trigger: 'autopilot', briefId: b2, autopilotConfigId: ids.cfgA, status: 'success' });
  await logs(child2, [stageMarker('pesquisa'), stageMarker('redacao'), stageMarker('publicacao')]);

  const p = await getRunProgress(A, discover);
  assert.ok(p);
  // a descoberta em si terminou, mas um filho ainda gera: a tela NÃO pode parar de acompanhar
  assert.equal(p.run.status, 'success');
  assert.equal(p.done, false);
  assert.equal(p.posts.length, 2);
  const gen = p.posts.find((x) => x.briefId === b1)!;
  assert.equal(gen.runStatus, 'running');
  assert.equal(gen.stages.find((x) => x.key === 'redacao')!.status, 'active');
  const done = p.posts.find((x) => x.briefId === b2)!;
  assert.equal(done.wpUrl, 'https://a.example/p/2');
  // pauta sem geração enfileirada aparece à parte, e o tema descartado não aparece em lugar nenhum
  assert.deepEqual(p.pendingBriefs, [{ briefId: b3, topic: 'Pauta sem geração automática' }]);

  // quando o filho termina, o conjunto termina
  await db.update(s.runs).set({ status: 'success' }).where(s.eq(s.runs.id, child1));
  assert.equal((await getRunProgress(A, discover))!.done, true);
});

test('regerar uma pauta acompanha o run MAIS RECENTE, não o antigo que falhou', async () => {
  const { getRunProgress } = await import('../src/lib/run-progress');
  const discover = await run(A, { kind: 'discover', status: 'success', autopilotConfigId: ids.cfgA });
  const b = await brief(A, ids.siteA, ids.tplA, 'Pauta regerada');
  await db.insert(s.discoveredTopics).values({
    workspaceId: A, autopilotConfigId: ids.cfgA, runId: discover, topic: 'Pauta regerada', contentType: 'evergreen', status: 'queued', briefId: b,
  });
  const old = await run(A, { kind: 'create', briefId: b, status: 'failed', startedAt: new Date(Date.now() - 600_000) });
  const recent = await run(A, { kind: 'create', briefId: b, status: 'running' });
  const p = await getRunProgress(A, discover);
  assert.deepEqual(p!.posts.map((x) => x.runId), [recent]);
  assert.notEqual(p!.posts[0]!.runId, old);
  assert.equal(p!.done, false);
});

test('descoberta sem nenhuma pauta: termina sozinha e não inventa posts', async () => {
  const { getRunProgress } = await import('../src/lib/run-progress');
  const discover = await run(A, { kind: 'discover', status: 'success', autopilotConfigId: ids.cfgA });
  const p = await getRunProgress(A, discover);
  assert.equal(p!.done, true);
  assert.deepEqual(p!.posts, []);
  assert.deepEqual(p!.pendingBriefs, []);
});

test('run em andamento ainda não terminou, e o de outro cliente é invisível (404, não vazamento)', async () => {
  const { getRunProgress } = await import('../src/lib/run-progress');
  const briefId = await brief(A, ids.siteA, ids.tplA, 'Privada');
  const runId = await run(A, { kind: 'create', briefId });
  await logs(runId, ['segredo do cliente A: chave xyz', stageMarker('pesquisa')]);

  const own = await getRunProgress(A, runId);
  assert.equal(own!.done, false);
  assert.equal(own!.run.status, 'running');

  // B pede o id do run de A: nada, exatamente como um id que não existe
  assert.equal(await getRunProgress(B, runId), null);
  assert.equal(await getRunProgress(B, randomUUID()), null);
});

test('o limite de logs devolve as MAIS RECENTES, em ordem cronológica', async () => {
  const { getRunProgress } = await import('../src/lib/run-progress');
  const runId = await run(A, { kind: 'update' });
  await logs(runId, Array.from({ length: 350 }, (_, i) => `linha ${i}`));
  const p = await getRunProgress(A, runId);
  assert.equal(p!.logs.length, 300);
  assert.equal(p!.logs[0]!.line, 'linha 50');
  assert.equal(p!.logs.at(-1)!.line, 'linha 349');
  // update não tem etapas: a tela mostra só o log
  assert.deepEqual(p!.stages, []);
});
