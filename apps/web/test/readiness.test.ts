import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { createDb } from '@content-pilot/db';
import * as s from '@content-pilot/db';
import { encryptCredential } from '@content-pilot/core';

/**
 * Regressao do falso positivo relatado em producao.
 *
 * `model_catalog` e o catalogo da INSTALACAO: ele so recebe modelos nativos
 * dos provedores para os quais existe chave da PLATAFORMA. Um cliente BYOK em
 * OpenAI, numa instalacao sem chave OpenAI da plataforma, nao tem uma linha
 * sequer para comparar — e a versao anterior concluia "modelo nao existe" e
 * bloqueava as cinco etapas de um pipeline que funcionava.
 */

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) {
  throw new Error('Use TEST_DATABASE_URL apontando para um banco descartavel terminado em _test.');
}
process.env.DATABASE_URL = url;
const masterKey = randomBytes(32);
process.env.VAULT_MASTER_KEYS = `k1:${masterKey.toString('base64')}`;
process.env.VAULT_ACTIVE_KEY_ID = 'k1';
process.env.ADMIN_EMAIL = 'owner@example.test';

const db = createDb(url);
const ws = randomUUID();
const profileId = randomUUID();
const email = 'byok@example.test';

function cred(id: string, workspaceId: string) {
  return encryptCredential({ apiKey: 'fake' }, {
    keys: new Map([['k1', masterKey]]), activeKeyId: 'k1', workspaceId, credentialId: id,
  });
}

before(async () => {
  await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../../../packages/db/drizzle') });
  await db.insert(s.workspaces).values({ id: ws, name: 'BYOK' });
  await db.insert(s.users).values({ workspaceId: ws, email, passwordHash: 'test-only' });
  await db.insert(s.modelProfiles).values({ id: profileId, slug: `p-${profileId}`, name: 'P', isDefault: true });
  // perfil do admin aponta para OpenRouter, como no seed
  await db.insert(s.modelProfileEntries).values(
    (['generate', 'verify', 'discover', 'dedupe', 'illustrate'] as const).map((purpose) => ({
      profileId, purpose, provider: 'openrouter' as const, modelId: 'z-ai/glm-5.2',
    })),
  );
  // catalogo SO com openrouter — o estado real de quem nao tem chave da plataforma
  await db.insert(s.modelCatalog).values({
    provider: 'openrouter', modelId: 'z-ai/glm-5.2', displayName: 'GLM', available: true, supportsVision: true,
  });
  const ids = { openai: randomUUID(), tavily: randomUUID(), wp: randomUUID() };
  await db.insert(s.credentials).values([
    { id: ids.openai, workspaceId: ws, type: 'openai', name: 'OpenAI', ciphertext: cred(ids.openai, ws), keyId: 'k1' },
    { id: ids.tavily, workspaceId: ws, type: 'tavily', name: 'Tavily', ciphertext: cred(ids.tavily, ws), keyId: 'k1' },
    { id: ids.wp, workspaceId: ws, type: 'wordpress', name: 'WP', ciphertext: cred(ids.wp, ws), keyId: 'k1' },
  ]);
  await db.insert(s.sites).values({ workspaceId: ws, name: 'Site', baseUrl: 'https://x.com', credentialId: ids.wp });
  // escolha BYOK: modelo que o catalogo da instalacao NAO conhece
  await db.insert(s.workspaceAiSettings).values({ workspaceId: ws, provider: 'openai', model: 'gpt-5.4-mini' });
});

after(async () => {
  await db.execute(s.sql`delete from sites where workspace_id = ${ws}::uuid`);
  await db.execute(s.sql`delete from credentials where workspace_id = ${ws}::uuid`);
  await db.execute(s.sql`delete from workspace_ai_settings where workspace_id = ${ws}::uuid`);
  await db.execute(s.sql`delete from users where workspace_id = ${ws}::uuid`);
  await db.delete(s.modelProfiles).where(eq(s.modelProfiles.id, profileId));
  await db.delete(s.modelCatalog).where(eq(s.modelCatalog.modelId, 'z-ai/glm-5.2'));
  await db.execute(s.sql`delete from workspaces where id = ${ws}::uuid`);
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

test('BYOK em provedor fora do catalogo da instalacao nao bloqueia', async () => {
  const { getWorkspaceReadiness } = await import('../src/lib/readiness');
  const r = await getWorkspaceReadiness(ws, email);
  const notInCatalog = r.issues.filter((i) => i.code === 'model-not-in-catalog');
  assert.deepEqual(notInCatalog, [], 'o catalogo da instalacao nao sabe nada sobre a conta BYOK do cliente');
  assert.equal(r.ok, true, `nao deveria bloquear: ${r.issues.map((i) => i.message).join(' | ')}`);
});

test('ainda bloqueia o que e comprovadamente quebrado', async () => {
  const { getWorkspaceReadiness } = await import('../src/lib/readiness');
  await db.execute(s.sql`delete from credentials where workspace_id = ${ws}::uuid and type = 'tavily'`);
  try {
    const r = await getWorkspaceReadiness(ws, email);
    assert.equal(r.ok, false);
    assert.ok(r.issues.some((i) => i.code === 'missing-credential' && i.blocking));
  } finally {
    const id = randomUUID();
    await db.insert(s.credentials).values({ id, workspaceId: ws, type: 'tavily', name: 'Tavily', ciphertext: cred(id, ws), keyId: 'k1' });
  }
});

test('modelo invalido AINDA e pego quando o catalogo cobre o provedor', async () => {
  const { getWorkspaceReadiness } = await import('../src/lib/readiness');
  // Sem escolha BYOK o perfil do admin (openrouter) vale — e o catalogo cobre
  // openrouter. Precisa da credencial openrouter tambem: sem ela o aviso seria
  // "falta credencial", que e o problema mais fundamental e vem antes.
  const orId = randomUUID();
  await db.insert(s.credentials).values({ id: orId, workspaceId: ws, type: 'openrouter', name: 'OR', ciphertext: cred(orId, ws), keyId: 'k1' });
  await db.execute(s.sql`update workspace_ai_settings set provider = null, model = null, prefer_own_keys = false where workspace_id = ${ws}::uuid`);
  await db.update(s.modelProfileEntries).set({ modelId: 'z-ai/modelo-que-nao-existe' }).where(eq(s.modelProfileEntries.profileId, profileId));
  // O perfil e lido via cachedConfig. No app quem invalida e runAdminAction,
  // que bumpa a versao dentro da transacao da mutacao; aqui escrevemos direto
  // no banco, entao invalidamos na mao para ler o estado novo.
  s.invalidateConfigCache();
  try {
    const r = await getWorkspaceReadiness(ws, 'owner@example.test');
    assert.ok(
      r.issues.some((i) => i.code === 'model-not-in-catalog' && i.blocking),
      `catalogo cobre openrouter, entao a conclusao e confiavel. issues=${JSON.stringify(r.issues.map((i) => i.code))}`,
    );
    assert.equal(r.ok, false);
  } finally {
    await db.update(s.modelProfileEntries).set({ modelId: 'z-ai/glm-5.2' }).where(eq(s.modelProfileEntries.profileId, profileId));
    await db.execute(s.sql`update workspace_ai_settings set provider = 'openai', model = 'gpt-5.4-mini' where workspace_id = ${ws}::uuid`);
    await db.delete(s.credentials).where(eq(s.credentials.id, orId));
    s.invalidateConfigCache();
  }
});
