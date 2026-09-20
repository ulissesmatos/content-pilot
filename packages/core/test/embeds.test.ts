import { describe, expect, it } from 'vitest';
import {
  canonicalTweetUrl,
  canonicalYoutubeUrl,
  embedBlock,
  parseTweet,
  parseYoutubeId,
  type EmbedItem,
} from '../src/embeds/parse';
import { findEmbeds, type FindEmbedsDeps } from '../src/embeds/find';
import { injectEmbeds, planEmbedParagraphs } from '../src/embeds/inject';
import { injectAfterParagraphs, paragraphEnds } from '../src/html/inline-images';
import type { LlmCompleteRequest, LlmProvider } from '../src/llm/types';
import type { SearchClient, SearchOptions } from '../src/search/tavily';
import { isReviewEnabled, parseTemplateConfig, resolveEmbedPolicy } from '../src/templates/schema';
import { gameCodesTemplate } from '../src/templates/seeds/game-codes';
import { genericArticleTemplate } from '../src/templates/seeds/generic-article';
import { BudgetExceededError } from '../src/pipeline/types';

const ID = 'dQw4w9WgXcQ';

describe('parseYoutubeId', () => {
  it('reconhece todas as formas de link de vídeo', () => {
    for (const url of [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtube.com/watch?v=${ID}&t=42s`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}`,
      `https://youtu.be/${ID}?si=abc`,
      `https://www.youtube.com/embed/${ID}`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube-nocookie.com/embed/${ID}`,
    ]) {
      expect(parseYoutubeId(url), url).toBe(ID);
    }
  });

  it('recusa o que não é vídeo: canal, playlist, id malformado, outro domínio, protocolo estranho', () => {
    for (const url of [
      'https://www.youtube.com/@canal',
      'https://www.youtube.com/playlist?list=PL123',
      'https://www.youtube.com/watch?v=curto',
      'https://www.youtube.com/watch?v=' + 'x'.repeat(30),
      'https://notyoutube.com/watch?v=' + ID,
      'https://evil.com/?u=https://youtube.com/watch?v=' + ID,
      `javascript:alert('${ID}')`,
      'não é url',
      '',
    ]) {
      expect(parseYoutubeId(url), url).toBeNull();
    }
  });

  it('canonicaliza para watch?v=', () => {
    expect(canonicalYoutubeUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
  });
});

describe('parseTweet', () => {
  it('reconhece twitter.com e x.com, com e sem www/mobile', () => {
    for (const url of [
      'https://twitter.com/Roblox/status/1700000000000000000',
      'https://x.com/Roblox/status/1700000000000000000',
      'https://www.x.com/Roblox/status/1700000000000000000?s=20',
      'https://mobile.twitter.com/Roblox/status/1700000000000000000/',
    ]) {
      expect(parseTweet(url), url).toEqual({ user: 'Roblox', id: '1700000000000000000' });
    }
  });

  it('recusa perfil, busca, lista, id curto e domínio parecido', () => {
    for (const url of [
      'https://twitter.com/Roblox',
      'https://x.com/search?q=roblox',
      'https://x.com/i/lists/123',
      'https://x.com/Roblox/status/12',
      'https://x.com/Roblox/status/abc',
      'https://fakex.com/Roblox/status/1700000000000000000',
      'https://x.com.evil.com/Roblox/status/1700000000000000000',
    ]) {
      expect(parseTweet(url), url).toBeNull();
    }
  });

  it('canonicaliza para twitter.com, que qualquer WordPress reconhece', () => {
    expect(canonicalTweetUrl({ user: 'Roblox', id: '17000' })).toBe('https://twitter.com/Roblox/status/17000');
  });
});

describe('embedBlock', () => {
  it('vídeo sai no formato exato que o editor do Gutenberg serializa, com proporção 16:9', () => {
    const b = embedBlock({ kind: 'youtube', url: `https://www.youtube.com/watch?v=${ID}` });
    expect(b).toContain('<!-- wp:embed {"url":"https://www.youtube.com/watch?v=' + ID + '"');
    expect(b).toContain('"providerNameSlug":"youtube"');
    expect(b).toContain('wp-embed-aspect-16-9');
    expect(b).toContain('<div class="wp-block-embed__wrapper">');
    expect(b).toContain('<!-- /wp:embed -->');
  });

  it('tweet sai como embed rico do provedor twitter', () => {
    const b = embedBlock({ kind: 'tweet', url: 'https://twitter.com/Roblox/status/17000' });
    expect(b).toContain('"providerNameSlug":"twitter"');
    expect(b).toContain('is-provider-twitter');
    expect(b).toContain('https://twitter.com/Roblox/status/17000');
  });

  it('blocos abrem e fecham em par (o validador do post exige)', () => {
    for (const kind of ['youtube', 'tweet'] as const) {
      const b = embedBlock({ kind, url: 'https://x' });
      expect(b.match(/<!-- wp:/g)).toHaveLength(1);
      expect(b.match(/<!-- \/wp:/g)).toHaveLength(1);
    }
  });
});

// ---------- findEmbeds ----------

const VIDEO_OK = 'aaaaaaaaaaa';
const VIDEO_GONE = 'bbbbbbbbbbb';
const VIDEO_OFFTOPIC = 'ccccccccccc';

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** oEmbed falso: cada URL responde como a plataforma responderia. */
function fakeOembed(routes: Record<string, Response | (() => Response)>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const u = new URL(String(input));
    const target = u.searchParams.get('url') ?? '';
    const r = routes[target];
    if (!r) return new Response('nao achei', { status: 404 });
    return typeof r === 'function' ? r() : r.clone();
  }) as typeof fetch;
}

function fakeSearch(byDomain: Record<string, string[]>): SearchClient & { calls: Array<{ q: string; opts?: SearchOptions }> } {
  const calls: Array<{ q: string; opts?: SearchOptions }> = [];
  return {
    calls,
    async search(q, opts) {
      calls.push({ q, opts });
      const key = opts?.includeDomains?.[0] ?? '';
      return { results: (byDomain[key] ?? []).map((url) => ({ url, title: 'x' })) };
    },
    async extract() {
      return { results: [], failed_results: [] };
    },
  };
}

function fakeLlm(reply: object | Error): LlmProvider & { calls: LlmCompleteRequest[] } {
  const calls: LlmCompleteRequest[] = [];
  return {
    provider: 'openai',
    model: 'gpt-x',
    calls,
    async complete(req) {
      calls.push(req);
      if (reply instanceof Error) throw reply;
      return { text: JSON.stringify(reply), inputTokens: 5, outputTokens: 5, costUsd: null, truncated: false, provider: 'openai', model: 'gpt-x', durationMs: 1 };
    },
  };
}

const yt = (id: string) => `https://www.youtube.com/watch?v=${id}`;
const routes = {
  [yt(VIDEO_OK)]: jsonRes({ title: 'Roblox: novo chat entre amigos (trailer oficial)', author_name: 'Roblox' }),
  [yt(VIDEO_GONE)]: jsonRes({ error: 'not found' }, 404),
  [yt(VIDEO_OFFTOPIC)]: jsonRes({ title: 'Receita de bolo de cenoura', author_name: 'Cozinha da Vó' }),
  'https://twitter.com/Roblox/status/1700000000000000001': jsonRes({
    author_name: 'Roblox',
    html: '<blockquote class="twitter-tweet"><p>O novo chat entre amigos do Roblox já está no ar!</p>&mdash; Roblox (@Roblox)</blockquote><script async src="https://platform.twitter.com/widgets.js"></script>',
  }),
  'https://twitter.com/Roblox/status/1700000000000000002': jsonRes({}, 404), // tweet apagado
};

const base = { topic: 'chat entre amigos do Roblox', language: 'pt-BR', wantVideo: true, maxTweets: 2 };
const search = () =>
  fakeSearch({
    'youtube.com': [yt(VIDEO_OK), yt(VIDEO_GONE), yt(VIDEO_OFFTOPIC), 'https://www.youtube.com/@canal', 'https://blog.example/post'],
    'x.com': [
      'https://x.com/Roblox/status/1700000000000000001',
      'https://x.com/Roblox/status/1700000000000000002',
      'https://x.com/Roblox',
    ],
  });
const deps = (over: Partial<FindEmbedsDeps> & Pick<FindEmbedsDeps, 'llm'>): FindEmbedsDeps => ({
  search: search(),
  fetchImpl: fakeOembed(routes),
  log: () => {},
  ...over,
});

describe('findEmbeds: a cadeia de defesa antes do modelo', () => {
  it('só chegam ao modelo candidatos que EXISTEM e são relevantes', async () => {
    const llm = fakeLlm({ video: 0, tweets: [1], reason: 'ok' });
    await findEmbeds(base, deps({ llm }));
    const prompt = llm.calls[0]!.prompt;
    expect(prompt).toContain('trailer oficial'); // vídeo verificado
    expect(prompt).toContain('O novo chat entre amigos'); // tweet verificado
    expect(prompt).not.toContain('bolo de cenoura'); // existe, mas não tem nada a ver com o assunto
    // o link de canal (@canal) e o de blog nem viraram candidato: só 2 itens chegam ao modelo
    expect(prompt.match(/^\d+: \[/gm)).toHaveLength(2);
  });

  it('vídeo apagado/privado e tweet removido (oEmbed 404) saem antes do modelo', async () => {
    const llm = fakeLlm({ video: 0, tweets: [1], reason: '' });
    const out = await findEmbeds(base, deps({ llm }));
    expect(out.embeds.map((e) => e.url)).toEqual([yt(VIDEO_OK), 'https://twitter.com/Roblox/status/1700000000000000001']);
    expect(llm.calls[0]!.prompt).not.toContain('1700000000000000002');
  });

  it('busca restrita aos domínios certos e sem baixar o texto das páginas', async () => {
    const s = search();
    await findEmbeds(base, deps({ llm: fakeLlm({ video: -1, tweets: [], reason: '' }), search: s }));
    const domains = s.calls.map((c) => c.opts?.includeDomains?.join(','));
    expect(domains).toContain('youtube.com,youtu.be');
    expect(domains).toContain('x.com,twitter.com');
    for (const c of s.calls) expect(c.opts?.rawContent).toBe(false);
  });

  it('as URLs saem canonizadas, e nunca são escritas pelo modelo', async () => {
    const out = await findEmbeds(base, deps({ llm: fakeLlm({ video: 0, tweets: [1], reason: '' }) }));
    expect(out.embeds[0]).toMatchObject({ kind: 'youtube', url: yt(VIDEO_OK), author: 'Roblox' });
    expect(out.embeds[1]).toMatchObject({ kind: 'tweet', url: 'https://twitter.com/Roblox/status/1700000000000000001' });
    // o texto do tweet vem limpo, sem HTML nem script
    expect(out.embeds[1]!.title).not.toMatch(/<|script/);
    expect(out.embeds[1]!.title).toContain('O novo chat entre amigos');
  });
});

describe('findEmbeds: a escolha do modelo é validada', () => {
  it('índice fora da lista, de tipo errado ou repetido é ignorado', async () => {
    const out = await findEmbeds(base, deps({ llm: fakeLlm({ video: 99, tweets: [99, -3, 0, 0], reason: '' }) }));
    // índice 0 é o vídeo, que não pode ser aceito na lista de tweets
    expect(out.embeds).toEqual([]);
  });

  it('respeita o máximo de tweets e um único vídeo', async () => {
    const out = await findEmbeds({ ...base, maxTweets: 1 }, deps({ llm: fakeLlm({ video: 0, tweets: [1, 1, 1], reason: '' }) }));
    expect(out.embeds.filter((e) => e.kind === 'tweet')).toHaveLength(1);
    expect(out.embeds.filter((e) => e.kind === 'youtube')).toHaveLength(1);
  });

  it('o modelo pode não escolher nada, e isso é bom', async () => {
    const out = await findEmbeds(base, deps({ llm: fakeLlm({ video: -1, tweets: [], reason: 'nada serve' }) }));
    expect(out.embeds).toEqual([]);
    expect(out.notes.join(' ')).toMatch(/nenhum que valha/);
  });

  it('wantVideo desligado ignora um vídeo mesmo que o modelo o escolha', async () => {
    const out = await findEmbeds({ ...base, wantVideo: false }, deps({ llm: fakeLlm({ video: 0, tweets: [], reason: '' }) }));
    expect(out.embeds.filter((e) => e.kind === 'youtube')).toEqual([]);
  });
});

describe('findEmbeds: falhas nunca derrubam o post', () => {
  it('nada a buscar: não chama busca nem modelo', async () => {
    const s = search();
    const llm = fakeLlm({ video: 0, tweets: [], reason: '' });
    const out = await findEmbeds({ ...base, wantVideo: false, maxTweets: 0 }, deps({ llm, search: s }));
    expect(out.embeds).toEqual([]);
    expect(s.calls).toHaveLength(0);
    expect(llm.calls).toHaveLength(0);
  });

  it('nenhum candidato verificado: não gasta o modelo', async () => {
    const llm = fakeLlm({ video: 0, tweets: [], reason: '' });
    const out = await findEmbeds(base, deps({ llm, fetchImpl: fakeOembed({}) }));
    expect(out.embeds).toEqual([]);
    expect(llm.calls).toHaveLength(0);
  });

  it('busca com erro e falha de rede no oEmbed viram lista vazia, com o motivo', async () => {
    const failing: SearchClient = {
      async search() {
        return { results: [], error: 'HTTP 429' };
      },
      async extract() {
        return { results: [], failed_results: [] };
      },
    };
    const out = await findEmbeds(base, deps({ llm: fakeLlm({ video: 0, tweets: [], reason: '' }), search: failing }));
    expect(out.embeds).toEqual([]);
    expect(out.notes.join(' ')).toMatch(/429/);

    const net = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    expect((await findEmbeds(base, deps({ llm: fakeLlm({ video: 0, tweets: [], reason: '' }), fetchImpl: net }))).embeds).toEqual([]);
  });

  it('falha do modelo: segue sem embeds e registra por quê', async () => {
    const { LlmError } = await import('../src/llm/client');
    const out = await findEmbeds(base, deps({ llm: fakeLlm(new LlmError('HTTP 500')) }));
    expect(out.embeds).toEqual([]);
    expect(out.notes.join(' ')).toMatch(/500/);
  });

  it('orçamento esgotado: não chama o modelo', async () => {
    const llm = fakeLlm({ video: 0, tweets: [], reason: '' });
    const out = await findEmbeds(base, deps({
      llm,
      checkBudget: () => {
        throw new BudgetExceededError('sem orçamento');
      },
    }));
    expect(out.embeds).toEqual([]);
    expect(llm.calls).toHaveLength(0);
  });
});

// ---------- injeção ----------

const P = (t: string) => `<!-- wp:paragraph --><p>${t}</p><!-- /wp:paragraph -->`;
const HTML = Array.from({ length: 10 }, (_, i) => P(`Parágrafo número ${i + 1} do artigo.`)).join('');
const embeds: EmbedItem[] = [
  { kind: 'youtube', id: ID, url: yt(ID), title: 'v', author: 'a' },
  { kind: 'tweet', id: '1', url: 'https://twitter.com/a/status/10000', title: 't', author: 'a' },
  { kind: 'tweet', id: '2', url: 'https://twitter.com/a/status/20000', title: 't', author: 'a' },
];

describe('planEmbedParagraphs / injectEmbeds', () => {
  it('vídeo por volta de um terço do texto; tweets mais adiante e espaçados', () => {
    const plan = planEmbedParagraphs(10, embeds);
    expect(plan[0]!).toBeLessThan(plan[1]!);
    expect(plan[1]!).toBeLessThan(plan[2]!);
    expect(plan[0]!).toBeGreaterThanOrEqual(2);
    expect(plan[0]!).toBeLessThanOrEqual(4);
  });

  it('nunca cai no parágrafo de uma imagem', () => {
    const avoid = [3, 5, 8];
    const plan = planEmbedParagraphs(10, embeds, avoid);
    for (const p of plan) expect(avoid).not.toContain(p);
    expect(new Set(plan).size).toBe(plan.length);
  });

  it('em ordem de documento e sem repetir, mesmo com quase todos os parágrafos ocupados', () => {
    const plan = planEmbedParagraphs(5, embeds, [0, 1]);
    expect(new Set(plan).size).toBe(3);
    for (const p of plan) expect([0, 1]).not.toContain(p);
  });

  it('texto curto demais (menos de 2 parágrafos) não recebe embed', () => {
    expect(planEmbedParagraphs(1, embeds)).toEqual([]);
    expect(injectEmbeds(P('só um'), embeds)).toBe(P('só um'));
  });

  it('injeta os blocos preservando a estrutura e todo o texto', () => {
    const out = injectEmbeds(HTML, embeds);
    expect(out.match(/<!-- wp:embed/g)).toHaveLength(3);
    expect(out.match(/<!-- wp:/g)!.length).toBe(out.match(/<!-- \/wp:/g)!.length);
    for (let i = 1; i <= 10; i++) expect(out).toContain(`Parágrafo número ${i} do artigo.`);
    // e a ordem: vídeo antes dos tweets
    expect(out.indexOf(yt(ID))).toBeLessThan(out.indexOf('status/10000'));
    expect(out.indexOf('status/10000')).toBeLessThan(out.indexOf('status/20000'));
  });

  it('sem embeds ou sem HTML, devolve como veio', () => {
    expect(injectEmbeds(HTML, [])).toBe(HTML);
    expect(injectEmbeds('', embeds)).toBe('');
  });

  it('coexiste com imagens já injetadas: os índices de parágrafo continuam valendo', () => {
    const withImages = injectAfterParagraphs(HTML, [
      { afterParagraph: 3, image: { url: 'https://wp/a.webp', alt: 'a', mediaId: 1 } },
    ]);
    // imagem não cria parágrafo novo
    expect(paragraphEnds(withImages)).toHaveLength(10);
    const out = injectEmbeds(withImages, embeds, { avoidParagraphs: [3] });
    expect(out.match(/<!-- wp:image/g)).toHaveLength(1);
    expect(out.match(/<!-- wp:embed/g)).toHaveLength(3);
  });
});

describe('política de embeds por template', () => {
  it('artigo: 1 vídeo e até 2 tweets; template de dados estruturados: nada', () => {
    expect(resolveEmbedPolicy(parseTemplateConfig(genericArticleTemplate.config))).toEqual({ video: true, maxTweets: 2 });
    expect(resolveEmbedPolicy(parseTemplateConfig(gameCodesTemplate.config))).toEqual({ video: false, maxTweets: 0 });
  });

  it('o template pode sobrescrever, e template antigo sem o bloco segue válido', () => {
    const forced = parseTemplateConfig({ ...genericArticleTemplate.config, embeds: { video: false, maxTweets: 0 } });
    expect(resolveEmbedPolicy(forced)).toEqual({ video: false, maxTweets: 0 });
    expect(isReviewEnabled(forced)).toBe(true);
  });
});
