import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

/**
 * O "último uso" de uma credencial em /credentials é gravado quando o provedor ACEITOU uma
 * chamada, e não quando a chave foi carregada, testada ou a chamada falhou. Postgres, vault e
 * resolução de credenciais são código real; só a rede (fetch) é falsa.
 */

const url = process.env.TEST_DATABASE_URL;
const enabled = Boolean(url && new URL(url).pathname.endsWith('_test'));
if (enabled) process.env.DATABASE_URL = url;
process.env.ADMIN_EMAIL = 'owner@example.test';
process.env.VAULT_MASTER_KEYS = `k1:${randomBytes(32).toString('base64')}`;
process.env.VAULT_ACTIVE_KEY_ID = 'k1';

let dbMod: typeof import('@content-pilot/db');
let core: typeof import('@content-pilot/core');
let resolveMod: typeof import('../src/lib/resolve');
let usage: typeof import('../src/lib/credential-usage');
let db: import('@content-pilot/db').Db;
const ws = randomUUID();
const ids = { tavily: randomUUID(), openai: randomUUID() };

const lastUsed = async (id: string) => {
  const [row] = await db.select({ at: dbMod.credentials.lastUsedAt }).from(dbMod.credentials).where(dbMod.eq(dbMod.credentials.id, id));
  return row!.at;
};
const reset = () => db.update(dbMod.credentials).set({ lastUsedAt: null }).where(dbMod.eq(dbMod.credentials.workspaceId, ws));

const describeIf = enabled ? describe : describe.skip;

describeIf('último uso real das credenciais (Postgres real, rede falsa)', () => {
  beforeAll(async () => {
    dbMod = await import('@content-pilot/db');
    core = await import('@content-pilot/core');
    resolveMod = await import('../src/lib/resolve');
    usage = await import('../src/lib/credential-usage');
    db = dbMod.createDb(url);
    await dbMod.migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../../../packages/db/drizzle') });

    await db.insert(dbMod.workspaces).values({ id: ws, name: 'USO' });
    const keys = core.parseMasterKeys(process.env.VAULT_MASTER_KEYS);
    const add = async (id: string, type: 'tavily' | 'openai', apiKey: string) => {
      const ciphertext = core.encryptCredential(
        { apiKey },
        { keys, activeKeyId: 'k1', workspaceId: core.credentialVaultScope(ws), credentialId: id },
      );
      await db.insert(dbMod.credentials).values({ id, workspaceId: ws, type, name: type, ciphertext, keyId: 'k1', maskedHint: apiKey.slice(-4) });
    };
    await add(ids.tavily, 'tavily', 'tvly-test-key');
    await add(ids.openai, 'openai', 'sk-test-key-1234');
  });

  afterAll(async () => {
    if (!db) return;
    await db.execute(dbMod.sql`delete from credentials where workspace_id = ${ws}::uuid`);
    await db.execute(dbMod.sql`delete from workspaces where id = ${ws}::uuid`);
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
  });

  beforeEach(async () => {
    usage.resetCredentialUsageThrottle();
    await reset();
  });
  afterEach(() => vi.unstubAllGlobals());

  // dá tempo da gravação "fire and forget" terminar
  const settle = () => new Promise((r) => setTimeout(r, 150));

  it('busca Tavily que respondeu: marca o uso da chave', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ results: [{ url: 'https://a.com', title: 't', content: 'c' }] })));
    const search = await resolveMod.resolveSearchClient(db, ws);
    expect(await lastUsed(ids.tavily)).toBeNull(); // carregar a chave não é usá-la
    await search.search('roblox chat');
    await settle();
    expect(await lastUsed(ids.tavily)).toBeInstanceOf(Date);
  });

  it('busca Tavily que devolveu erro (chave inválida): NÃO marca', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Unauthorized', { status: 401 })));
    const search = await resolveMod.resolveSearchClient(db, ws);
    const res = await search.search('roblox chat');
    expect(res.results).toEqual([]);
    await settle();
    expect(await lastUsed(ids.tavily)).toBeNull();
  });

  it('chamada de IA que deu certo marca o uso da chave OpenAI usada', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 3 },
        }),
      ),
    );
    const llm = await resolveMod.resolveLlmProvider(db, ws, { provider: 'openai', model: 'gpt-4.1-mini' });
    expect(await lastUsed(ids.openai)).toBeNull();
    await llm.complete({ prompt: 'oi', schema: { type: 'object', properties: {}, additionalProperties: false }, schemaName: 'x', maxTokens: 50 });
    await settle();
    expect(await lastUsed(ids.openai)).toBeInstanceOf(Date);
    // e a chave Tavily, que esta chamada não usou, continua sem uso
    expect(await lastUsed(ids.tavily)).toBeNull();
  });

  it('chamada de IA que falhou (HTTP 401) não marca nada', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 })));
    const llm = await resolveMod.resolveLlmProvider(db, ws, { provider: 'openai', model: 'gpt-4.1-mini' });
    await expect(
      llm.complete({ prompt: 'oi', schema: { type: 'object', properties: {}, additionalProperties: false }, schemaName: 'x', maxTokens: 50 }),
    ).rejects.toThrow();
    await settle();
    expect(await lastUsed(ids.openai)).toBeNull();
  });

  it('muitas chamadas seguidas gravam uma vez por minuto (o artigo faz dezenas)', async () => {
    const t0 = 1_800_000_000_000;
    await usage.touchCredential(db, ids.tavily, t0);
    const first = await lastUsed(ids.tavily);
    expect(first?.getTime()).toBe(t0);
    await usage.touchCredential(db, ids.tavily, t0 + 30_000); // 30 s depois: ignorado
    expect((await lastUsed(ids.tavily))?.getTime()).toBe(t0);
    await usage.touchCredential(db, ids.tavily, t0 + 61_000); // passou o minuto: grava
    expect((await lastUsed(ids.tavily))?.getTime()).toBe(t0 + 61_000);
  });

  it('erro do banco ao gravar não derruba nem propaga, e libera o próximo aviso', async () => {
    const throwing = { update: () => { throw new Error('conexão caiu'); } } as unknown as typeof db;
    await expect(usage.touchCredential(throwing, ids.tavily, 1)).resolves.toBeUndefined();
    const rejecting = {
      update: () => ({ set: () => ({ where: () => Promise.reject(new Error('timeout')) }) }),
    } as unknown as typeof db;
    await expect(usage.touchCredential(rejecting, ids.tavily, 2)).resolves.toBeUndefined();
    // a falha não deixou o throttle travado: o aviso seguinte grava
    await usage.touchCredential(db, ids.tavily, 3);
    expect((await lastUsed(ids.tavily))?.getTime()).toBe(3);
  });
});
