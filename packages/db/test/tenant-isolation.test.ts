import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, sql } from 'drizzle-orm';
import { createDb, createTenantDb, getDb } from '../src/client';
import * as s from '../src/schema';
import { encryptCredential } from '@content-pilot/core';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) {
  throw new Error('Use TEST_DATABASE_URL apontando para um banco descartável com nome terminado em _test.');
}
process.env.DATABASE_URL = url;
const db = createDb(url);
const a = randomUUID(), b = randomUUID();
const tenantA = createTenantDb(db, a), tenantB = createTenantDb(db, b);
const fixtures: Record<string, { credential: string; site: string; template: string; job: string; brief: string; run: string }> = {};
const builtin = randomUUID(), platformKey = randomUUID(), platformSearchKey = randomUUID();
const ownerEmail = `owner-${a}@example.test`;
const savedAdminEmail = process.env.ADMIN_EMAIL;
const savedVaultKeys = process.env.VAULT_MASTER_KEYS;
const testMasterKey = randomBytes(32);
function secret(credentialId: string, workspaceId = 'platform') {
  return encryptCredential({ apiKey: 'synthetic-test-key' }, {
    keys: new Map([['test', testMasterKey]]), activeKeyId: 'test', workspaceId, credentialId,
  });
}

before(async () => {
  process.env.ADMIN_EMAIL = ownerEmail;
  process.env.VAULT_MASTER_KEYS = `test:${testMasterKey.toString('base64')}`;
  await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../drizzle') });
  await db.insert(s.workspaces).values([{ id: a, name: 'A' }, { id: b, name: 'B' }]);
  await db.insert(s.contentTemplates).values({ id: builtin, slug: `builtin-${builtin}`, name: 'Shared', config: {}, isBuiltin: true });
  await db.insert(s.credentials).values({ id: platformKey, type: 'openai', name: 'Platform secret', ciphertext: secret(platformKey), keyId: 'test' });
  await db.insert(s.credentials).values({ id: platformSearchKey, type: 'tavily', name: 'Platform search', ciphertext: secret(platformSearchKey), keyId: 'test' });
  await db.insert(s.users).values([
    { workspaceId: a, email: ownerEmail, passwordHash: 'test-only', role: 'admin' },
    { workspaceId: b, email: `member-${b}@example.test`, passwordHash: 'test-only' },
  ]);
  for (const workspaceId of [a, b]) {
    const f = fixtures[workspaceId] = { credential: randomUUID(), site: randomUUID(), template: randomUUID(), job: randomUUID(), brief: randomUUID(), run: randomUUID() };
    await db.insert(s.credentials).values({ id: f.credential, workspaceId, type: 'wordpress', name: 'WP', ciphertext: 'secret', keyId: 'k1' });
    await db.insert(s.sites).values({ id: f.site, workspaceId, name: 'Site', baseUrl: 'https://example.com', credentialId: f.credential });
    await db.insert(s.contentTemplates).values({ id: f.template, workspaceId, slug: 'private', name: 'Private', config: {} });
    await db.insert(s.contentJobs).values({ id: f.job, workspaceId, siteId: f.site, templateId: f.template, name: 'Job', postFilter: {}, scheduleCron: '0 * * * *', llmConfig: {}, limits: {} });
    await db.insert(s.briefs).values({ id: f.brief, workspaceId, siteId: f.site, templateId: f.template, topic: 'Private topic' });
    await db.insert(s.runs).values({ id: f.run, workspaceId, jobId: f.job, trigger: 'manual' });
    await db.insert(s.runLogs).values({ runId: f.run, ts: new Date(), line: `Private ${workspaceId}` });
    await db.insert(s.subscriptions).values({ workspaceId });
  }
});

after(async () => {
  // Only remove IDs allocated by this test, making repeated executions safe.
  try {
    for (const table of ['run_items', 'runs', 'content_jobs', 'briefs', 'sites', 'credentials', 'content_templates', 'subscriptions', 'users']) {
      await db.execute(sql`delete from ${sql.identifier(table)} where workspace_id in (${a}::uuid, ${b}::uuid)`);
    }
    await db.delete(s.contentTemplates).where(eq(s.contentTemplates.id, builtin));
    await db.delete(s.credentials).where(eq(s.credentials.id, platformKey));
    await db.delete(s.credentials).where(eq(s.credentials.id, platformSearchKey));
    await db.execute(sql`delete from workspaces where id in (${a}::uuid, ${b}::uuid)`);
  } finally {
    if (savedAdminEmail === undefined) delete process.env.ADMIN_EMAIL; else process.env.ADMIN_EMAIL = savedAdminEmail;
    if (savedVaultKeys === undefined) delete process.env.VAULT_MASTER_KEYS; else process.env.VAULT_MASTER_KEYS = savedVaultKeys;
    const pool = (db as typeof db & { $client: import('pg').Pool }).$client;
    const globalPool = (getDb() as typeof db & { $client: import('pg').Pool }).$client;
    await Promise.all([pool.end(), globalPool.end()]);
  }
});

test('unfiltered queries and joins cannot read another tenant', async () => {
  assert.deepEqual((await tenantA.select().from(s.sites)).map(x => x.id), [fixtures[a]!.site]);
  assert.deepEqual((await tenantB.select().from(s.sites)).map(x => x.id), [fixtures[b]!.site]);
  const joined = await tenantA.select({ site: s.sites.id, credential: s.credentials.id }).from(s.sites)
    .innerJoin(s.credentials, eq(s.sites.credentialId, s.credentials.id));
  assert.deepEqual(joined, [{ site: fixtures[a]!.site, credential: fixtures[a]!.credential }]);
  assert.equal((await tenantA.select().from(s.runLogs)).length, 1);
  assert.equal((await tenantA.select().from(s.runLogs))[0]!.runId, fixtures[a]!.run);
  assert.equal((await tenantA.select().from(s.credentials)).length, 1);
});

test('foreign IDs cannot update/delete data, and foreign workspace inserts fail', async () => {
  assert.equal((await tenantA.update(s.sites).set({ name: 'Hijacked' }).where(eq(s.sites.id, fixtures[b]!.site)).returning()).length, 0);
  assert.equal((await tenantA.delete(s.sites).where(eq(s.sites.id, fixtures[b]!.site)).returning()).length, 0);
  await assert.rejects(tenantA.insert(s.sites).values({ workspaceId: b, name: 'Injected', baseUrl: 'https://example.com' }));
});

test('shared templates are read-only and platform secrets are invisible', async () => {
  assert.equal((await tenantA.select().from(s.contentTemplates)).length, 2);
  assert.equal((await tenantA.update(s.contentTemplates).set({ name: 'Hijacked' }).where(eq(s.contentTemplates.id, builtin)).returning()).length, 0);
  assert.equal((await tenantA.delete(s.credentials).where(eq(s.credentials.id, platformKey)).returning()).length, 0);
  await assert.rejects(tenantA.insert(s.credentials).values({ type: 'openai', name: 'Global', ciphertext: 'x', keyId: 'k1' }));
});

test('billing, roles, audit, notes and global settings cannot be mutated/read through tenant DB', async () => {
  await assert.rejects(tenantA.update(s.subscriptions).set({ plan: 'unlimited' }));
  await assert.rejects(tenantA.update(s.workspaces).set({ billingBypass: true }));
  await assert.rejects(tenantA.select({ notes: s.workspaces.notes }).from(s.workspaces));
  await assert.rejects(tenantA.select().from(s.users));
  await assert.rejects(tenantA.select().from(s.auditLogs));
  await assert.rejects(tenantA.select().from(s.platformSettings));
});

test('cross-tenant foreign keys fail even using the privileged worker connection', async () => {
  await assert.rejects(db.insert(s.sites).values({ workspaceId: a, name: 'Bad', baseUrl: 'https://example.com', credentialId: fixtures[b]!.credential }));
  await assert.rejects(db.insert(s.briefs).values({ workspaceId: a, siteId: fixtures[b]!.site, templateId: builtin, topic: 'Bad' }));
  await assert.rejects(db.insert(s.briefs).values({ workspaceId: a, siteId: fixtures[a]!.site, templateId: fixtures[b]!.template, topic: 'Bad' }));
  await assert.rejects(db.insert(s.runs).values({ workspaceId: a, jobId: fixtures[b]!.job, trigger: 'manual' }));
  await assert.rejects(db.insert(s.runItems).values({ workspaceId: a, runId: fixtures[b]!.run, status: 'failed' }));
  await assert.rejects(db.update(s.contentTemplates).set({ workspaceId: null }).where(eq(s.contentTemplates.id, fixtures[b]!.template)));
});

test('deleting an origin preserves run history and its tenant', async () => {
  const [job] = await tenantA.insert(s.contentJobs).values({ workspaceId: a, siteId: fixtures[a]!.site, templateId: builtin, name: 'Disposable', postFilter: {}, scheduleCron: '0 * * * *', llmConfig: {}, limits: {} }).returning();
  const [run] = await tenantA.insert(s.runs).values({ workspaceId: a, jobId: job!.id, trigger: 'manual' }).returning();
  await tenantA.delete(s.contentJobs).where(eq(s.contentJobs.id, job!.id));
  const [kept] = await tenantA.select().from(s.runs).where(eq(s.runs.id, run!.id));
  assert.equal(kept!.jobId, null);
  assert.equal(kept!.workspaceId, a);
});

test('parallel queries, transactions and rollback never leak pooled tenant context', async () => {
  await Promise.all(Array.from({ length: 30 }, async (_, i) => {
    const own = i % 2 ? a : b;
    const rows = await createTenantDb(db, own).select().from(s.sites);
    assert.ok(rows.every(row => row.workspaceId === own));
  }));
  await tenantA.transaction(async tx => {
    assert.equal((await tx.select().from(s.sites))[0]!.workspaceId, a);
  });
  await assert.rejects(tenantB.transaction(async tx => {
    await tx.update(s.sites).set({ name: 'Rolled back' });
    throw new Error('rollback');
  }));
  assert.equal((await tenantB.select().from(s.sites))[0]!.name, 'Site');
  const role = await db.execute(sql`select current_user as role`);
  assert.notEqual(role.rows[0]!.role, 'content_pilot_tenant');
});

test('restricted role without context fails closed', async () => {
  await db.transaction(async tx => {
    await tx.execute(sql`set local role content_pilot_tenant`);
    await tx.execute(sql`select set_config('app.workspace_id', '', true)`);
    assert.equal((await tx.select().from(s.sites)).length, 0);
  });
});

test('rate limits reserve atomically across concurrent requests', async () => {
  const { consumeRateLimit } = await import('../../../apps/web/src/lib/rate-limit');
  const key = randomUUID();
  const results = await Promise.all(Array.from({ length: 15 }, () => consumeRateLimit('login:email', key)));
  assert.equal(results.filter(Boolean).length, 5);
});

test('workers reject mismatched run/source before external requests', async () => {
  const { handleBriefGenerate } = await import('../../../apps/worker/src/queues/brief-generate');
  await assert.rejects(handleBriefGenerate(db, { briefId: fixtures[b]!.brief, runId: fixtures[a]!.run }), /ownership mismatch/);
});

test('other accounts cannot resolve global AI credentials, including explicit IDs', async () => {
  const { resolveLlmProvider } = await import('../../../apps/worker/src/lib/resolve');
  await assert.rejects(resolveLlmProvider(db, b, { provider: 'openai', model: 'test' }), /Nenhuma credencial/);
  await assert.rejects(resolveLlmProvider(db, b, { provider: 'openai', model: 'test', credentialId: platformKey }), /indisponível/);
  await assert.rejects(resolveLlmProvider(db, b, { provider: 'openai', model: 'test', credentialId: fixtures[a]!.credential }), /indisponível/);
});

test('worker refuses a suspended workspace', async () => {
  const { assertWorkerWorkspace } = await import('../../../apps/worker/src/lib/tenant');
  await db.update(s.workspaces).set({ status: 'suspended' }).where(eq(s.workspaces.id, a));
  try { await assert.rejects(assertWorkerWorkspace(db, a), /indisponível/); }
  finally { await db.update(s.workspaces).set({ status: 'active' }).where(eq(s.workspaces.id, a)); }
});


test('only the installation owner can use global AI and search keys without a billing exemption', async () => {
  const { resolveLlmProvider, resolveSearchClient } = await import('../../../apps/worker/src/lib/resolve');
  assert.ok(await resolveLlmProvider(db, a, { provider: 'openai', model: 'test' }));
  assert.ok(await resolveLlmProvider(db, a, { provider: 'openai', model: 'test', credentialId: platformKey }));
  assert.ok(await resolveSearchClient(db, a));
});

test('paid plans, unlimited quota and ordinary admins never unlock system keys', async () => {
  const { resolveLlmProvider, resolveSearchClient } = await import('../../../apps/worker/src/lib/resolve');
  await db.update(s.users).set({ role: 'admin' }).where(eq(s.users.workspaceId, b));
  try {
    for (const plan of ['free', 'starter', 'pro', 'unlimited']) {
      await db.update(s.subscriptions).set({ plan }).where(eq(s.subscriptions.workspaceId, b));
      for (const billingBypass of [false, true]) {
        await db.update(s.workspaces).set({ billingBypass }).where(eq(s.workspaces.id, b));
        await assert.rejects(resolveLlmProvider(db, b, { provider: 'openai', model: 'test' }), /Nenhuma credencial/);
        await assert.rejects(resolveLlmProvider(db, b, { provider: 'openai', model: 'test', credentialId: platformKey }), /indisponível/);
        await assert.rejects(resolveSearchClient(db, b), /Nenhuma credencial Tavily/);
      }
    }
  } finally {
    await db.update(s.users).set({ role: 'owner' }).where(eq(s.users.workspaceId, b));
    await db.update(s.subscriptions).set({ plan: 'free' }).where(eq(s.subscriptions.workspaceId, b));
    await db.update(s.workspaces).set({ billingBypass: false }).where(eq(s.workspaces.id, b));
  }
});

test('BYOK works for other accounts; missing or broken own keys never fall back globally', async () => {
  const { resolveLlmProvider, resolveSearchClient } = await import('../../../apps/worker/src/lib/resolve');
  const ownAi = randomUUID(), ownSearch = randomUUID();
  await db.insert(s.credentials).values([
    { id: ownAi, workspaceId: b, type: 'openai', name: 'Own AI', ciphertext: secret(ownAi, b), keyId: 'test' },
    { id: ownSearch, workspaceId: b, type: 'tavily', name: 'Own search', ciphertext: secret(ownSearch, b), keyId: 'test' },
  ]);
  try {
    assert.ok(await resolveLlmProvider(db, b, { provider: 'openai', model: 'test' }));
    assert.ok(await resolveLlmProvider(db, b, { provider: 'openai', model: 'test', credentialId: ownAi }));
    assert.ok(await resolveSearchClient(db, b));
    await assert.rejects(resolveLlmProvider(db, a, { provider: 'openai', model: 'test', credentialId: ownAi }), /indisponível/);
    await db.update(s.credentials).set({ ciphertext: 'corrupt' }).where(eq(s.credentials.id, ownAi));
    await assert.rejects(resolveLlmProvider(db, b, { provider: 'openai', model: 'test' }), /ciphertext/);
  } finally {
    await db.delete(s.credentials).where(eq(s.credentials.id, ownAi));
    await db.delete(s.credentials).where(eq(s.credentials.id, ownSearch));
  }
  await assert.rejects(resolveLlmProvider(db, b, { provider: 'openai', model: 'test' }), /Nenhuma credencial/);
  await assert.rejects(resolveSearchClient(db, b), /Nenhuma credencial Tavily/);
});

test('owner authorization fails closed on missing configuration, revocation or shared workspace', async () => {
  const { canUsePlatformKeys } = await import('../../../apps/worker/src/lib/platform-access');
  delete process.env.ADMIN_EMAIL;
  try { assert.equal(await canUsePlatformKeys(db, a), false); }
  finally { process.env.ADMIN_EMAIL = ownerEmail; }
  process.env.ADMIN_EMAIL = `  ${ownerEmail.toUpperCase()}  `;
  try { assert.equal(await canUsePlatformKeys(db, a), true); }
  finally { process.env.ADMIN_EMAIL = ownerEmail; }
  for (const patch of [{ status: 'suspended' as const }, { status: 'banned' as const }, { deletedAt: new Date() }]) {
    await db.update(s.users).set(patch).where(eq(s.users.workspaceId, a));
    try { assert.equal(await canUsePlatformKeys(db, a), false); }
    finally { await db.update(s.users).set({ status: 'active', deletedAt: null }).where(eq(s.users.workspaceId, a)); }
  }
  await db.update(s.workspaces).set({ status: 'suspended' }).where(eq(s.workspaces.id, a));
  try { assert.equal(await canUsePlatformKeys(db, a), false); }
  finally { await db.update(s.workspaces).set({ status: 'active' }).where(eq(s.workspaces.id, a)); }
  const [other] = await db.insert(s.users).values({ workspaceId: a, email: `shared-${a}@example.test`, passwordHash: 'test-only' }).returning();
  try { assert.equal(await canUsePlatformKeys(db, a), false); }
  finally { await db.delete(s.users).where(eq(s.users.id, other!.id)); }
  assert.equal(await canUsePlatformKeys(db, a), true);
});

test('BYOK detection only counts the workspace own LLM keys', async () => {
  const { usesOwnLlmKey } = await import('../src/billing/byok');
  // A só tem credencial wordpress; a chave de IA existente é da plataforma
  assert.equal(await usesOwnLlmKey(db, a), false);
  const tavilyOnly = randomUUID();
  await db.insert(s.credentials).values({ id: tavilyOnly, workspaceId: a, type: 'tavily', name: 'Busca', ciphertext: secret(tavilyOnly, a), keyId: 'test' });
  try {
    // busca própria não é chave de IA: não libera cota de geração
    assert.equal(await usesOwnLlmKey(db, a), false);
  } finally { await db.delete(s.credentials).where(eq(s.credentials.id, tavilyOnly)); }
  const own = randomUUID();
  await db.insert(s.credentials).values({ id: own, workspaceId: a, type: 'openrouter', name: 'Minha IA', ciphertext: secret(own, a), keyId: 'test' });
  try {
    assert.equal(await usesOwnLlmKey(db, a), true);
    // a chave de A não pode liberar cota de B
    assert.equal(await usesOwnLlmKey(db, b), false);
  } finally { await db.delete(s.credentials).where(eq(s.credentials.id, own)); }
  assert.equal(await usesOwnLlmKey(db, a), false);
});

test('email tokens are single-use, expire, and never reach the tenant role', async () => {
  const { consumeAuthToken, issueAuthToken } = await import('../src/auth/tokens');
  const [user] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, ownerEmail)).limit(1);
  const userId = user!.id;

  const token = await issueAuthToken(db, { userId, type: 'password_reset', ip: '203.0.113.9' });

  // O valor do link não pode estar legível no banco: só o hash.
  const stored = await db.select().from(s.authTokens).where(eq(s.authTokens.userId, userId));
  assert.equal(stored.length, 1);
  assert.notEqual(stored[0]!.tokenHash, token);
  assert.match(stored[0]!.tokenHash, /^[0-9a-f]{64}$/);

  // Tipo errado não resgata, mesmo com o token certo.
  assert.equal(await consumeAuthToken(db, token, 'email_verify'), null);

  // Duas tentativas simultâneas: exatamente uma vence.
  const [first, second] = await Promise.all([
    consumeAuthToken(db, token, 'password_reset'),
    consumeAuthToken(db, token, 'password_reset'),
  ]);
  assert.equal([first, second].filter(Boolean).length, 1);
  assert.equal((first ?? second)!.userId, userId);

  // E o terceiro uso, em sequência, também falha.
  assert.equal(await consumeAuthToken(db, token, 'password_reset'), null);

  // Pedir de novo invalida o link anterior — dois links vivos dobram a janela.
  const older = await issueAuthToken(db, { userId, type: 'password_reset' });
  const newer = await issueAuthToken(db, { userId, type: 'password_reset' });
  assert.equal(await consumeAuthToken(db, older, 'password_reset'), null);
  assert.ok(await consumeAuthToken(db, newer, 'password_reset'));

  // Token expirado não vale, mesmo intacto.
  const expired = await issueAuthToken(db, { userId, type: 'email_verify' });
  await db.execute(sql`update auth_tokens set expires_at = now() - interval '1 minute' where used_at is null`);
  assert.equal(await consumeAuthToken(db, expired, 'email_verify'), null);

  // Valor inventado nunca resgata.
  assert.equal(await consumeAuthToken(db, 'nao-existe-token-qualquer', 'password_reset'), null);
  assert.equal(await consumeAuthToken(db, '', 'password_reset'), null);

  // O papel de cliente não enxerga a tabela: o link de troca de senha de
  // qualquer conta seria a chave mestra do produto. Conferimos a CAUSA, e não
  // só que rejeitou — "tabela não existe" passaria por um rejects genérico.
  await assert.rejects(tenantA.select().from(s.authTokens), (err: unknown) => {
    const cause = (err as { cause?: { message?: string } }).cause;
    assert.match(String(cause?.message ?? err), /permission denied for table auth_tokens/i);
    return true;
  });

  await db.delete(s.authTokens).where(eq(s.authTokens.userId, userId));
});

test('seed repairs OpenRouter-style model ids in the direction that keeps the operator key', async () => {
  const { checkProviderModel } = await import('@content-pilot/core');
  const profileId = randomUUID();
  await db.insert(s.modelProfiles).values({ id: profileId, slug: `repair-${profileId}`, name: 'Reparo' });
  await db.insert(s.modelProfileEntries).values([
    // o caso real de producao: prefixo apenas repete o provedor escolhido
    { profileId, purpose: 'generate', provider: 'openai', modelId: 'openai/gpt-4o-mini' },
    // id de OUTRO fornecedor: nao existe equivalente nativo na OpenAI
    { profileId, purpose: 'verify', provider: 'openai', modelId: 'anthropic/claude-sonnet-4.5' },
    // ja correto: o reparo nao pode encostar
    { profileId, purpose: 'discover', provider: 'openai', modelId: 'gpt-4o-mini' },
    // openrouter depende do prefixo para enderecar o modelo
    { profileId, purpose: 'dedupe', provider: 'openrouter', modelId: 'deepseek/deepseek-v4-flash' },
  ]);
  try {
    // aplica a mesma decisao que o seed aplica, linha a linha
    const rows = await db.select().from(s.modelProfileEntries).where(eq(s.modelProfileEntries.profileId, profileId));
    for (const row of rows) {
      const check = checkProviderModel(row.provider, row.modelId);
      if (check.fix === 'stripped-prefix') {
        await db.update(s.modelProfileEntries).set({ modelId: check.modelId }).where(eq(s.modelProfileEntries.id, row.id));
      } else if (check.fix === 'foreign-vendor') {
        await db.update(s.modelProfileEntries).set({ provider: 'openrouter' }).where(eq(s.modelProfileEntries.id, row.id));
      }
    }

    const after = Object.fromEntries(
      (await db.select().from(s.modelProfileEntries).where(eq(s.modelProfileEntries.profileId, profileId)))
        .map((r) => [r.purpose, `${r.provider}:${r.modelId}`]),
    );
    // prefixo removido E credencial OpenAI preservada — trocar para openrouter
    // exigiria uma chave que o operador nao cadastrou
    assert.equal(after.generate, 'openai:gpt-4o-mini');
    // sem equivalente nativo: unica leitura coerente e' rotear pelo OpenRouter
    assert.equal(after.verify, 'openrouter:anthropic/claude-sonnet-4.5');
    assert.equal(after.discover, 'openai:gpt-4o-mini');
    assert.equal(after.dedupe, 'openrouter:deepseek/deepseek-v4-flash');
  } finally {
    await db.delete(s.modelProfiles).where(eq(s.modelProfiles.id, profileId));
  }
});
