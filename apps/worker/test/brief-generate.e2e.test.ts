import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import sharp from 'sharp';
import type {
  CmsAdapter,
  CmsCreatePostInput,
  CmsMediaUpload,
  ImageGenClient,
  LlmCompleteRequest,
  LlmProvider,
  SearchClient,
} from '@content-pilot/core';

/**
 * Ponta a ponta de `handleBriefGenerate`: pauta -> pesquisa -> redação -> revisão ->
 * imagens -> embeds -> WordPress -> banco. Postgres, pipeline, revisor, imagens
 * (sharp) e embeds são código REAL. Só a rede e os provedores são falsos: o LLM
 * responde conforme o `schemaName` de cada etapa.
 *
 * Existe porque a orquestração é a peça mais fácil de quebrar e a mais cara de
 * descobrir quebrada: um erro na sequência só apareceria em produção.
 */

const url = process.env.TEST_DATABASE_URL;
const enabled = Boolean(url && new URL(url).pathname.endsWith('_test'));
if (enabled) process.env.DATABASE_URL = url;
process.env.ADMIN_EMAIL = 'owner@example.test';

// ---------- rede falsa (publicFetch): imagens, páginas de fonte e oEmbed ----------
const net = new Map<string, () => Response | Promise<Response>>();
vi.mock('@content-pilot/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@content-pilot/core')>();
  return {
    ...actual,
    publicFetch: vi.fn(async (input: string | URL | Request) => {
      const key = String(input).replace(/^(https:\/\/[^?]*oembed)\?url=([^&]+).*$/, (_m, base, u) => `${base}|${decodeURIComponent(u)}`);
      const h = net.get(key);
      return h ? h() : new Response('nada', { status: 404 });
    }),
    OpenverseClient: class {
      async search() {
        return [];
      }
    },
  };
});

// ---------- provedores falsos (resolve.ts) ----------
interface World {
  llm: (req: LlmCompleteRequest) => object;
  llmCalls: Array<{ schema: string; purpose?: string }>;
  posts: CmsCreatePostInput[];
  uploads: CmsMediaUpload[];
  imageGen: ImageGenClient | null;
  imageUrls: string[];
  templateConfig: unknown;
}
const world: World = {
  llm: () => ({}),
  llmCalls: [],
  posts: [],
  uploads: [],
  imageGen: null,
  imageUrls: [],
  templateConfig: null,
};

vi.mock('../src/lib/resolve', () => {
  const fakeLlm = (): LlmProvider => ({
    provider: 'openai',
    model: 'gpt-x',
    async complete(req) {
      world.llmCalls.push({ schema: req.schemaName });
      return {
        text: JSON.stringify(world.llm(req)),
        inputTokens: 10,
        outputTokens: 10,
        costUsd: null,
        truncated: false,
        provider: 'openai',
        model: 'gpt-x',
        durationMs: 1,
      };
    },
  });
  return {
    preflightLlmTasks: async () => [],
    resolveLlmProvider: async () => fakeLlm(),
    resolveImageGenProvider: async () => world.imageGen,
    resolveSearchClient: async (): Promise<SearchClient> => ({
      async search(_q, opts) {
        const domain = opts?.includeDomains?.[0];
        if (domain === 'youtube.com') return { results: [{ url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', title: 'v' }] };
        if (domain === 'x.com') return { results: [{ url: 'https://x.com/Roblox/status/1700000000000000001', title: 't' }] };
        return {
          results: [
            { url: 'https://ign.com/roblox-chat', title: 'IGN', content: 'resumo', raw_content: 'O Roblox liberou chat entre amigos para 150 milhões de usuários. '.repeat(40) },
            { url: 'https://gamespot.com/roblox-chat', title: 'GameSpot', content: 'resumo', raw_content: 'Chat entre amigos chega ao Roblox com controle dos pais. '.repeat(40) },
          ],
        };
      },
      async extract(urls) {
        return { results: urls.map((u) => ({ url: u, raw_content: 'Roblox chat entre amigos 150 milhões de usuários. '.repeat(40) })), failed_results: [] };
      },
      async searchImages() {
        return world.imageUrls.map((u) => ({ url: u, description: 'roblox chat entre amigos' }));
      },
    }),
    resolveTemplateById: async () => ({ id: 'tpl', slug: 'generic-article', config: world.templateConfig }),
    resolveWordPressAdapter: async (): Promise<CmsAdapter> =>
      ({
        async listRecentPostTitles() {
          return [];
        },
        async listCategories() {
          return [];
        },
        async uploadMedia(input: CmsMediaUpload) {
          world.uploads.push(input);
          const id = 900 + world.uploads.length;
          return { id, sourceUrl: `https://blog.example/wp-content/uploads/${input.filename}` };
        },
        async createPost(input: CmsCreatePostInput) {
          world.posts.push(input);
          return { id: 4242, title: input.title, slug: 's', link: 'https://blog.example/p/4242', contentRaw: input.content, usedRenderedFallback: false };
        },
      }) as unknown as CmsAdapter,
  };
});

// ---------- conteúdo fixo dos cenários ----------
const P = (t: string) => `<!-- wp:paragraph --><p>${t}</p><!-- /wp:paragraph -->`;
const H = (t: string) => `<!-- wp:heading {"level":3} --><h3 class="wp-block-heading">${t}</h3><!-- /wp:heading -->`;

// O modelo de redação DESOBEDECE as regras: travessão e data no título.
const DRAFT_HTML = [
  P('No mundo atual, o Roblox — plataforma com 150 milhões de usuários — liberou uma nova aba de chat entre amigos e muita gente ainda não sabe como ativar o recurso no aplicativo.'),
  H('Como ativar'),
  P('Abra o aplicativo e toque em <a href="https://ign.com/roblox-chat">amigos</a>. Depois escolha quem vai conversar com você e comece a enviar mensagens.'),
  P('É importante destacar que o recurso chegou primeiro ao celular, e só depois ao computador, segundo a própria empresa em comunicado oficial.'),
  H('Segurança'),
  P('Os pais podem limitar quem fala com os filhos pelas configurações da conta, com controles simples de usar e que não exigem nenhum aplicativo extra.'),
  P('Encerramos com uma dica: revise as configurações de privacidade sempre que o aplicativo receber uma atualização importante do sistema.'),
].join('');

const REVISED_HTML = [
  P('O Roblox, plataforma com 150 milhões de usuários, liberou uma aba de chat entre amigos que muita gente ainda não sabe como ativar no aplicativo.'),
  H('Como ativar'),
  P('Abra o aplicativo e toque em <a href="https://ign.com/roblox-chat">amigos</a>. Escolha quem vai conversar com você e comece a enviar mensagens.'),
  P('O recurso chegou primeiro ao celular e só depois ao computador, segundo a própria empresa em comunicado oficial.'),
  H('Segurança'),
  P('Os pais podem limitar quem fala com os filhos pelas configurações da conta, com controles simples de usar e que não exigem nenhum aplicativo extra.'),
  P('Revise as configurações de privacidade sempre que o aplicativo receber uma atualização importante do sistema.'),
].join('');

const generation = (html = DRAFT_HTML) => ({
  hasChanges: true,
  action: 'update',
  noDataFound: false,
  data: {},
  newTitle: 'Como funciona a nova aba de chat entre amigos do Roblox (20/09/2026): recursos e como testar',
  updatedHtml: html,
  metaDescription: 'Veja tudo — e aprenda a ativar o novo chat do Roblox.',
  category: null,
  changesSummary: 'artigo criado',
});

async function photo(w: number, h: number) {
  return new Uint8Array(
    await sharp({ create: { width: w, height: h, channels: 3, background: { r: 60, g: 110, b: 150 }, noise: { type: 'gaussian', mean: 128, sigma: 45 } } })
      .jpeg({ quality: 88 })
      .toBuffer(),
  );
}
const serveImage = (u: string, data: Uint8Array) =>
  net.set(u, () => new Response(data as BodyInit, { headers: { 'content-type': 'image/jpeg' } }));

function scriptedLlm(over: Partial<Record<string, (req: LlmCompleteRequest) => object>> = {}) {
  const base: Record<string, (req: LlmCompleteRequest) => object> = {
    content_pilot_update: () => generation(),
    content_pilot_review: () => ({
      revisedHtml: REVISED_HTML,
      changes: [{ kind: 'ai_tone', section: 'abertura', note: 'tirei o clichê de abertura' }],
      imageHints: [{ afterHeading: 'Segurança', description: 'tela de controle dos pais no aplicativo' }],
    }),
    autopilot_illustrate: () => ({ index: 0, alt: 'aba de amigos do Roblox', qualityOk: true, fits: true, reason: 'ok' }),
    content_pilot_embeds: () => ({ video: 0, tweets: [1], reason: 'oficiais' }),
  };
  const table = { ...base, ...over };
  world.llm = (req) => {
    const h = table[req.schemaName];
    if (!h) throw new Error(`LLM inesperado: ${req.schemaName}`);
    return h(req);
  };
}

// ---------- banco ----------
let dbMod: typeof import('@content-pilot/db');
let handle: typeof import('../src/queues/brief-generate').handleBriefGenerate;
let db: import('@content-pilot/db').Db;
const ws = randomUUID();
const profileId = randomUUID();

// Cada cenário precisa de um tema PRÓPRIO: o guarda anti-repetição (que é código real
// aqui) barra qualquer pauta cujo tema já tenha gerado um post neste workspace.
const TOPICS = [
  'chat entre amigos do Roblox',
  'novo sistema de missões diárias do Fortnite',
  'modo cooperativo de Minecraft na versão mobile',
  'atualização de personagens de Genshin Impact',
  'calendário de eventos sazonais do Free Fire',
  'controles parentais nos consoles de nova geração',
  'ranking competitivo de Valorant nesta temporada',
];
let topicCursor = 0;

async function newBrief(publishMode: 'draft' | 'publish' = 'draft') {
  const topic = TOPICS[topicCursor++ % TOPICS.length]!;
  const siteId = randomUUID();
  const templateId = randomUUID();
  const briefId = randomUUID();
  const runId = randomUUID();
  await db.insert(dbMod.sites).values({ id: siteId, workspaceId: ws, name: 'Blog', baseUrl: 'https://blog.example' });
  await db.insert(dbMod.contentTemplates).values({ id: templateId, workspaceId: ws, slug: `t-${templateId}`, name: 'T', config: {} });
  await db.insert(dbMod.briefs).values({
    id: briefId, workspaceId: ws, siteId, templateId, topic, keywords: ['roblox chat'], publishMode, status: 'queued',
  });
  await db.insert(dbMod.runs).values({ id: runId, workspaceId: ws, briefId, trigger: 'manual', status: 'running' });
  return { briefId, runId };
}

const describeIf = enabled ? describe : describe.skip;

describeIf('handleBriefGenerate (Postgres real, provedores falsos)', () => {
  beforeAll(async () => {
    dbMod = await import('@content-pilot/db');
    const { createDb, migrate } = dbMod;
    db = createDb(url);
    await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../../../packages/db/drizzle') });
    ({ handleBriefGenerate: handle } = await import('../src/queues/brief-generate'));

    // Isento de cota: o plano free permite 5 posts/mês e estes cenários criam mais que isso.
    // O enforcement em si é real e é coberto pela suíte de integração do db.
    await db.insert(dbMod.workspaces).values({ id: ws, name: 'E2E', billingBypass: true });
    await db.insert(dbMod.subscriptions).values({ workspaceId: ws });
    // perfil default com TODAS as etapas: exercita o resolveTaskModel real, incluindo `review`
    await db.insert(dbMod.modelProfiles).values({ id: profileId, slug: `e2e-${profileId}`, name: 'E2E', isDefault: true });
    await db.insert(dbMod.modelProfileEntries).values(
      (['generate', 'verify', 'discover', 'dedupe', 'illustrate', 'review'] as const).map((purpose) => ({
        profileId, purpose, provider: 'openai' as const, modelId: 'gpt-x',
      })),
    );
    // só este perfil pode ser o default durante o teste
    await db.execute(dbMod.sql`update model_profiles set is_default = (id = ${profileId}::uuid)`);
    dbMod.invalidateConfigCache();
  });

  afterAll(async () => {
    if (!db) return;
    for (const t of ['llm_calls', 'run_logs', 'run_items', 'runs', 'briefs', 'sites', 'content_templates', 'subscriptions']) {
      if (t === 'run_logs') {
        await db.execute(dbMod.sql`delete from run_logs where run_id in (select id from runs where workspace_id = ${ws}::uuid)`);
      } else {
        await db.execute(dbMod.sql`delete from ${dbMod.sql.identifier(t)} where workspace_id = ${ws}::uuid`);
      }
    }
    await db.execute(dbMod.sql`delete from model_profiles where id = ${profileId}::uuid`);
    await db.execute(dbMod.sql`delete from workspaces where id = ${ws}::uuid`);
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
  });

  beforeEach(async () => {
    net.clear();
    Object.assign(world, { llmCalls: [], posts: [], uploads: [], imageGen: null, imageUrls: [] });
    const { parseTemplateConfig, genericArticleTemplate } = await import('@content-pilot/core');
    world.templateConfig = parseTemplateConfig(genericArticleTemplate.config);
    scriptedLlm();

    // rede padrão: uma imagem boa, duas páginas de fonte, o vídeo e o tweet reais
    const good = await photo(1800, 1000);
    world.imageUrls = ['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg', 'https://cdn.example/c.jpg'];
    for (const u of world.imageUrls) serveImage(u, good);
    net.set('https://www.youtube.com/oembed|https://www.youtube.com/watch?v=aaaaaaaaaaa', () =>
      Response.json({ title: 'Roblox: novo chat entre amigos (trailer oficial)', author_name: 'Roblox' }),
    );
    net.set('https://publish.twitter.com/oembed|https://twitter.com/Roblox/status/1700000000000000001', () =>
      Response.json({ author_name: 'Roblox', html: '<blockquote><p>O novo chat entre amigos do Roblox já está no ar!</p></blockquote>' }),
    );
  });

  it('fluxo completo: texto sem travessão nem data, revisado, com capa e imagens em WebP, e embeds', async () => {
    const { briefId, runId } = await newBrief('draft');
    await handle(db, { briefId, runId });

    expect(world.posts).toHaveLength(1);
    const post = world.posts[0]!;

    // estilo: o modelo desobedeceu e a guarda corrigiu
    expect(post.title).toBe('Como funciona a nova aba de chat entre amigos do Roblox: recursos e como testar');
    expect(post.content).not.toMatch(/[—–]/);
    expect(post.excerpt).not.toMatch(/[—–]/);

    // revisão: o texto publicado é o revisado (sem o clichê)
    expect(post.content).not.toContain('No mundo atual');
    expect(post.content).toContain('Os pais podem limitar');

    // imagens: capa + corpo, todas WebP, com ID de mídia no HTML
    expect(post.featuredMediaId).toBeGreaterThan(900);
    expect(world.uploads.length).toBeGreaterThanOrEqual(2);
    for (const up of world.uploads) expect(up.mimeType).toBe('image/webp');
    expect(post.content).toMatch(/wp-image-9\d\d/);
    expect(post.content).toContain('https://blog.example/wp-content/uploads/');

    // embeds
    expect(post.content).toContain('providerNameSlug":"youtube"');
    expect(post.content).toContain('https://www.youtube.com/watch?v=aaaaaaaaaaa');
    expect(post.content).toContain('https://twitter.com/Roblox/status/1700000000000000001');

    // estrutura intacta e o link externo da fonte preservado
    expect(post.content!.match(/<!-- wp:/g)!.length).toBe(post.content!.match(/<!-- \/wp:/g)!.length);
    expect(post.content).toContain('href="https://ign.com/roblox-chat"');
    expect(post.status).toBe('draft');

    // banco
    const [brief] = await db.select().from(dbMod.briefs).where(dbMod.eq(dbMod.briefs.id, briefId));
    expect(brief).toMatchObject({ status: 'ready_for_review', createdWpPostId: 4242, error: null });
    const report = brief!.imageReport as import('@content-pilot/core').ImageReport;
    expect(report.coverMissing).toBe(false);
    expect(report.images.find((i) => i.slotId === 'cover')).toMatchObject({ role: 'cover', width: 1280, height: 720 });
    const editorial = brief!.editorialReport as { review: { status: string }; embeds: Array<{ kind: string }> };
    expect(editorial.review.status).toBe('revised');
    expect(editorial.embeds.map((e) => e.kind).sort()).toEqual(['tweet', 'youtube']);

    // o que o worker ESCREVEU no log é o que a tela de acompanhamento LÊ: as 6 etapas, em ordem
    const { deriveStages } = await import('@content-pilot/core');
    const lines = (
      await db.select().from(dbMod.runLogs).where(dbMod.eq(dbMod.runLogs.runId, runId)).orderBy(dbMod.asc(dbMod.runLogs.ts))
    ).map((l) => l.line);
    expect(deriveStages(lines, 'success', 'create').map((st) => `${st.key}:${st.status}`)).toEqual([
      'pesquisa:done', 'redacao:done', 'revisao:done', 'imagens:done', 'embeds:done', 'publicacao:done',
    ]);
    const markers = lines.filter((l) => l.startsWith('etapa: '));
    expect(markers).toEqual([
      'etapa: pesquisando fontes', 'etapa: escrevendo o artigo', 'etapa: revisão editorial',
      'etapa: imagens', 'etapa: vídeo e tweets', 'etapa: enviando ao WordPress',
    ]);

    // todas as etapas de IA gastaram tokens que foram registrados
    const calls = await db.select().from(dbMod.llmCalls).where(dbMod.eq(dbMod.llmCalls.runId, runId));
    const purposes = new Set(calls.map((c) => c.purpose));
    for (const p of ['generate', 'review', 'illustrate', 'verify']) expect(purposes.has(p as never), p).toBe(true);
  });

  it('SEM capa possível: o post NUNCA é publicado, nem em modo automático (vira rascunho)', async () => {
    world.imageUrls = []; // busca não acha nada
    world.imageGen = null; // e não há gerador de imagem
    const { briefId, runId } = await newBrief('publish');
    await handle(db, { briefId, runId });

    expect(world.posts).toHaveLength(1);
    expect(world.posts[0]!.status).toBe('draft');
    expect(world.posts[0]!.featuredMediaId).toBeUndefined();

    const [brief] = await db.select().from(dbMod.briefs).where(dbMod.eq(dbMod.briefs.id, briefId));
    expect(brief!.status).toBe('ready_for_review'); // e não 'published'
    expect((brief!.imageReport as { coverMissing: boolean }).coverMissing).toBe(true);
  });

  it('com gerador de imagem, a mesma situação ainda garante capa (WebP 1280x720) e pode publicar', async () => {
    world.imageUrls = [];
    const png = new Uint8Array(await sharp({ create: { width: 1536, height: 1024, channels: 3, background: { r: 10, g: 90, b: 160 }, noise: { type: 'gaussian', mean: 128, sigma: 40 } } }).png().toBuffer());
    world.imageGen = { async generate() { return { data: png, mimeType: 'image/png' }; } };
    const { briefId, runId } = await newBrief('publish');
    await handle(db, { briefId, runId });

    expect(world.posts[0]!.status).toBe('publish');
    expect(world.posts[0]!.featuredMediaId).toBeGreaterThan(900);
    const cover = world.uploads.find((u) => u.filename.includes('capa'))!;
    const meta = await sharp(cover.data).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 1280, 720]);
    const [brief] = await db.select().from(dbMod.briefs).where(dbMod.eq(dbMod.briefs.id, briefId));
    expect((brief!.imageReport as { images: Array<{ origin: string }> }).images[0]!.origin).toBe('generated');
  });

  it('revisão perigosa (número inventado) é descartada: o post sai com o texto ORIGINAL', async () => {
    scriptedLlm({
      content_pilot_review: () => ({
        revisedHtml: REVISED_HTML.replace('150 milhões', '999 milhões'),
        changes: [],
        imageHints: [],
      }),
    });
    const { briefId, runId } = await newBrief('draft');
    await handle(db, { briefId, runId });

    expect(world.posts[0]!.content).toContain('150 milhões');
    expect(world.posts[0]!.content).not.toContain('999');
    const [brief] = await db.select().from(dbMod.briefs).where(dbMod.eq(dbMod.briefs.id, briefId));
    const editorial = brief!.editorialReport as { review: { status: string; reason: string } };
    expect(editorial.review.status).toBe('rejected');
    expect(editorial.review.reason).toMatch(/999/);
  });

  it('etapa de revisão sem modelo configurado: o post sai normalmente, sem revisão', async () => {
    await db.execute(dbMod.sql`delete from model_profile_entries where profile_id = ${profileId}::uuid and purpose = 'review'`);
    dbMod.invalidateConfigCache();
    try {
      const { briefId, runId } = await newBrief('draft');
      await handle(db, { briefId, runId });
      expect(world.posts).toHaveLength(1);
      expect(world.llmCalls.map((c) => c.schema)).not.toContain('content_pilot_review');
      const [brief] = await db.select().from(dbMod.briefs).where(dbMod.eq(dbMod.briefs.id, briefId));
      expect(brief!.status).toBe('ready_for_review');
    } finally {
      await db.insert(dbMod.modelProfileEntries).values({ profileId, purpose: 'review', provider: 'openai', modelId: 'gpt-x' });
      dbMod.invalidateConfigCache();
    }
  });

  it('embeds sem nada verificado (vídeo apagado, tweet removido): o post sai sem embeds', async () => {
    net.delete('https://www.youtube.com/oembed|https://www.youtube.com/watch?v=aaaaaaaaaaa');
    net.delete('https://publish.twitter.com/oembed|https://twitter.com/Roblox/status/1700000000000000001');
    const { briefId, runId } = await newBrief('draft');
    await handle(db, { briefId, runId });
    expect(world.posts[0]!.content).not.toContain('wp:embed');
    // e o modelo de embeds nem foi chamado: sem candidato verificado não há o que escolher
    expect(world.llmCalls.map((c) => c.schema)).not.toContain('content_pilot_embeds');
  });

  it('template com embeds e revisão desligados não os executa', async () => {
    const { parseTemplateConfig, genericArticleTemplate } = await import('@content-pilot/core');
    world.templateConfig = parseTemplateConfig({
      ...genericArticleTemplate.config,
      review: { enabled: false },
      embeds: { video: false, maxTweets: 0 },
    });
    const { briefId, runId } = await newBrief('draft');
    await handle(db, { briefId, runId });
    const schemas = world.llmCalls.map((c) => c.schema);
    expect(schemas).not.toContain('content_pilot_review');
    expect(schemas).not.toContain('content_pilot_embeds');
    expect(world.posts[0]!.content).not.toContain('wp:embed');

    // etapa que o template desligou NÃO aparece como feita: a tela a mostra como pulada
    const { deriveStages } = await import('@content-pilot/core');
    const lines = (await db.select().from(dbMod.runLogs).where(dbMod.eq(dbMod.runLogs.runId, runId))).map((l) => l.line);
    const st = Object.fromEntries(deriveStages(lines, 'success', 'create').map((x) => [x.key, x.status]));
    expect(st).toMatchObject({ revisao: 'skipped', embeds: 'skipped', imagens: 'done', publicacao: 'done' });
  });
});
