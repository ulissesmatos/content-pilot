import { describe, expect, it } from 'vitest';
import {
  buildGenerationPrompt,
  illustrateArticle,
  type IllustrateDeps,
  type IllustrateInput,
  type PreparedImage,
} from '../src/images/illustrate';
import type { ImageCandidate, ImageSearchClient } from '../src/images/openverse';
import type { ImageGenClient } from '../src/images/generate';
import type { ImageSlot } from '../src/images/slots';
import type { LlmCompleteRequest, LlmCompleteResult, LlmProvider } from '../src/llm/types';
import { BudgetExceededError } from '../src/pipeline/types';

const HTML =
  '<!-- wp:paragraph --><p>O GTA 6 chega com um mapa enorme e muitas novidades para os jogadores.</p><!-- /wp:paragraph -->' +
  '<!-- wp:heading {"level":3} --><h3>Mapa e cidades</h3><!-- /wp:heading -->' +
  '<!-- wp:paragraph --><p>Vice City volta com bairros novos, praias e uma área rural inspirada na Flórida.</p><!-- /wp:paragraph -->' +
  '<!-- wp:paragraph --><p>A cidade muda conforme o horário, com trânsito e multidões em tempo real.</p><!-- /wp:paragraph -->' +
  '<!-- wp:heading {"level":3} --><h3>Personagens</h3><!-- /wp:heading -->' +
  '<!-- wp:paragraph --><p>Lucia e Jason são os protagonistas dessa história de crime e fuga.</p><!-- /wp:paragraph -->' +
  '<!-- wp:paragraph --><p>A dupla planeja assaltos enquanto tenta escapar da polícia estadual.</p><!-- /wp:paragraph -->' +
  '<!-- wp:paragraph --><p>O jogo promete mais liberdade que qualquer título anterior da série.</p><!-- /wp:paragraph -->';

const SIZE = { width: 1280, height: 720 };
const input: IllustrateInput = {
  topic: 'GTA 6',
  keywords: ['gta 6 trailer'],
  language: 'pt-BR',
  html: HTML,
  inlineCount: 2,
  coverSize: SIZE,
  inlineSize: SIZE,
  maxCandidates: 4,
};

function candidate(i: number, provider = 'web', batch = ''): ImageCandidate {
  return {
    url: `https://img.example/${provider}-${batch}${i}.jpg`,
    thumbnail: `https://img.example/${provider}-${i}.jpg`,
    title: `imagem ${i}`,
    license: provider === 'source-page' ? 'source' : 'web',
    attribution: provider === 'source-page' ? 'Imagem: ign.com' : '',
    sourcePage: `https://src.example/${i}`,
    provider,
  };
}

/**
 * Uma busca que devolve `n` candidatas, e registra as consultas recebidas.
 * `distinct`: cada consulta traz imagens diferentes, como uma busca de verdade.
 * Sem isso o pool é o mesmo em todo slot e encolhe conforme as imagens são usadas.
 */
function fakeImages(n: number, distinct = false): ImageSearchClient & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    async search(q) {
      const batch = distinct ? `q${queries.length}-` : '';
      queries.push(q);
      return Array.from({ length: n }, (_, i) => candidate(i, 'web', batch));
    },
  };
}

/** prepare que sempre funciona, ou falha para as urls indicadas (anti-hotlink). */
function fakePrepare(blocked: (url: string) => boolean = () => false): IllustrateDeps['prepare'] {
  return async (c) =>
    blocked(c.url)
      ? null
      : ({
          candidate: c,
          thumbnail: `data:image/jpeg;base64,THUMB-${c.url}`,
          original: { data: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg', width: 1600, height: 900 },
        } satisfies PreparedImage);
}

function fakeVision(responses: Array<Partial<LlmCompleteResult> | Error>): LlmProvider & { calls: LlmCompleteRequest[] } {
  const calls: LlmCompleteRequest[] = [];
  let i = 0;
  return {
    provider: 'openai',
    model: 'gpt-5.4-mini',
    calls,
    async complete(req) {
      calls.push(req);
      const next = responses[Math.min(i++, responses.length - 1)]!;
      if (next instanceof Error) throw next;
      return {
        text: '',
        inputTokens: 200,
        outputTokens: 30,
        costUsd: null,
        truncated: false,
        provider: 'openai',
        model: 'gpt-5.4-mini',
        durationMs: 5,
        ...next,
      };
    },
  };
}

const pick = (index: number, alt = 'alt escolhido', extra: Record<string, unknown> = {}) =>
  JSON.stringify({ index, alt, qualityOk: true, fits: true, reason: 'combina', ...extra });

function fakeImageGen(fail = false): ImageGenClient & { calls: Array<{ prompt: string; size?: unknown }> } {
  const calls: Array<{ prompt: string; size?: unknown }> = [];
  return {
    calls,
    async generate(prompt, opts) {
      calls.push({ prompt, size: opts?.size });
      if (fail) throw new Error('quota da OpenAI esgotada');
      return { data: new Uint8Array([9, 9, 9]), mimeType: 'image/png' };
    },
  };
}

function run(deps: Partial<IllustrateDeps> & Pick<IllustrateDeps, 'llmVision'>, inp: Partial<IllustrateInput> = {}) {
  const logs: string[] = [];
  const full: IllustrateDeps = { images: fakeImages(4), prepare: fakePrepare(), log: (m) => logs.push(m), ...deps };
  return illustrateArticle({ ...input, ...inp }, full).then((result) => ({ result, logs }));
}

describe('illustrateArticle: escolha por slot', () => {
  it('escolhe a capa pela visão e usa o alt que o modelo escreveu', async () => {
    const vision = fakeVision([{ text: pick(1, 'trailer do GTA 6') }, { text: pick(0) }, { text: pick(2) }]);
    const { result } = await run({ llmVision: vision });
    expect(result.cover?.origin).toBe('search');
    expect(result.cover?.alt).toBe('trailer do GTA 6');
    expect(result.coverMissing).toBe(false);
  });

  it('cada slot tem a própria busca e a própria chamada de visão', async () => {
    const images = fakeImages(4, true);
    const vision = fakeVision([{ text: pick(0) }, { text: pick(1) }, { text: pick(2) }]);
    const { result } = await run({ images, llmVision: vision });
    expect(vision.calls).toHaveLength(3); // capa + 2 imagens do corpo
    expect(images.queries).toHaveLength(3);
    // a consulta do slot do meio é afinada pela seção onde cai, não é a mesma da capa
    expect(new Set(images.queries).size).toBeGreaterThan(1);
    expect(result.inline).toHaveLength(2);
  });

  it('a imagem do corpo sabe em qual trecho cai (o prompt da visão traz o contexto do slot)', async () => {
    const vision = fakeVision([{ text: pick(0) }, { text: pick(1) }, { text: pick(2) }]);
    await run({ llmVision: vision });
    const inlinePrompt = vision.calls[1]!.prompt;
    expect(inlinePrompt).toMatch(/Vice City|Mapa e cidades|Lucia|Personagens/);
  });

  it('nenhuma imagem é reutilizada entre slots', async () => {
    const vision = fakeVision([{ text: pick(0) }]); // sempre escolhe o índice 0 do que lhe é mostrado
    const { result } = await run({ llmVision: vision });
    const urls = [result.cover, ...result.inline].filter(Boolean).map((c) => c!.original.data.length + c!.sourcePage);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('manda miniaturas em base64 para a visão, nunca as URLs originais', async () => {
    const vision = fakeVision([{ text: pick(0) }]);
    await run({ llmVision: vision }, { inlineCount: 0 });
    const images = vision.calls[0]!.images ?? [];
    expect(images.length).toBeGreaterThan(0);
    for (const img of images) expect(img.startsWith('data:image/')).toBe(true);
  });

  it('inlineCount 0 planeja só a capa', async () => {
    const vision = fakeVision([{ text: pick(0) }]);
    const { result } = await run({ llmVision: vision }, { inlineCount: 0 });
    expect(vision.calls).toHaveLength(1);
    expect(result.inline).toHaveLength(0);
  });

  it('a capa é preparada em busca de fontes oficiais primeiro', async () => {
    const vision = fakeVision([{ text: pick(0, 'da fonte') }]);
    const { result } = await run(
      { llmVision: vision, sourceImages: async () => [candidate(0, 'source-page')] },
      { inlineCount: 0 },
    );
    expect(result.cover?.origin).toBe('source');
    expect(result.cover?.caption).toBe('Imagem: ign.com');
  });
});

describe('illustrateArticle: quando nada serve, gera a imagem', () => {
  it('visão devolve -1 → gera capa por IA no tamanho do slot', async () => {
    const gen = fakeImageGen();
    const { result } = await run({ llmVision: fakeVision([{ text: pick(-1) }]), imageGen: gen }, { inlineCount: 0 });
    expect(result.cover?.origin).toBe('generated');
    expect(gen.calls[0]!.size).toEqual(SIZE);
    expect(result.coverMissing).toBe(false);
  });

  it('qualityOk=false ou fits=false reprovam mesmo com índice válido', async () => {
    for (const extra of [{ qualityOk: false }, { fits: false }]) {
      const gen = fakeImageGen();
      const { result } = await run(
        { llmVision: fakeVision([{ text: pick(0, 'x', extra) }]), imageGen: gen },
        { inlineCount: 0 },
      );
      expect(result.cover?.origin).toBe('generated');
    }
  });

  it('o caso do log real: a visão FALHA e ainda assim há capa (antes era llm_failed e desistia)', async () => {
    const { LlmError } = await import('../src/llm/client');
    const gen = fakeImageGen();
    const { result, logs } = await run(
      { llmVision: fakeVision([new LlmError('HTTP 400: Error while downloading https://x.com/a.jpg')]), imageGen: gen },
      { inlineCount: 0 },
    );
    expect(result.cover?.origin).toBe('generated');
    expect(result.coverMissing).toBe(false);
    // e o log diz o motivo, em vez do "llm_failed" mudo de antes
    expect(logs.join('\n')).toMatch(/visão falhou: HTTP 400: Error while downloading/);
  });

  it('falha de chamada tem uma segunda tentativa com menos imagens antes de gerar', async () => {
    const { LlmError } = await import('../src/llm/client');
    const vision = fakeVision([new LlmError('payload grande demais'), { text: pick(0, 'segunda tentativa') }]);
    const { result } = await run({ llmVision: vision, imageGen: fakeImageGen() }, { inlineCount: 0, maxCandidates: 6 });
    expect(vision.calls).toHaveLength(2);
    expect(vision.calls[1]!.images).toHaveLength(3);
    expect(result.cover?.origin).toBe('search');
    expect(result.cover?.alt).toBe('segunda tentativa');
  });

  it('todas as candidatas bloqueadas (anti-hotlink): nem chama a visão, vai direto à geração', async () => {
    const vision = fakeVision([{ text: pick(0) }]);
    const gen = fakeImageGen();
    const { result } = await run(
      { llmVision: vision, imageGen: gen, prepare: fakePrepare(() => true) },
      { inlineCount: 0 },
    );
    expect(vision.calls).toHaveLength(0);
    expect(result.cover?.origin).toBe('generated');
  });

  it('só as candidatas que falharam no download saem; as demais seguem para a visão', async () => {
    const vision = fakeVision([{ text: pick(0) }]);
    await run({ llmVision: vision, prepare: fakePrepare((u) => u.endsWith('web-0.jpg')) }, { inlineCount: 0 });
    expect(vision.calls[0]!.images).toHaveLength(3); // 4 candidatas, 1 bloqueada
  });

  it('sem nenhuma candidata e com gerador: gera a capa', async () => {
    const { result } = await run(
      { images: fakeImages(0), llmVision: fakeVision([{ text: pick(0) }]), imageGen: fakeImageGen() },
      { inlineCount: 0 },
    );
    expect(result.cover?.origin).toBe('generated');
  });

  it('cada slot do corpo também gera quando nada serve', async () => {
    const gen = fakeImageGen();
    const { result } = await run({ llmVision: fakeVision([{ text: pick(-1) }]), imageGen: gen });
    expect(result.cover?.origin).toBe('generated');
    expect(result.inline.map((i) => i.origin)).toEqual(['generated', 'generated']);
    expect(gen.calls).toHaveLength(3);
  });
});

describe('illustrateArticle: capa obrigatória', () => {
  it('sem candidata e sem gerador: coverMissing, para o chamador não publicar', async () => {
    const { result, logs } = await run(
      { images: fakeImages(0), llmVision: fakeVision([{ text: pick(0) }]) },
      { inlineCount: 0 },
    );
    expect(result.cover).toBeNull();
    expect(result.coverMissing).toBe(true);
    expect(result.status).toBe('no_images');
    expect(logs.join('\n')).toMatch(/NENHUMA capa/);
  });

  it('gerador falhou (cota, chave): coverMissing, e o motivo fica registrado', async () => {
    const { result, logs } = await run(
      { images: fakeImages(0), llmVision: fakeVision([{ text: pick(0) }]), imageGen: fakeImageGen(true) },
      { inlineCount: 0 },
    );
    expect(result.coverMissing).toBe(true);
    expect(logs.join('\n')).toMatch(/quota da OpenAI esgotada/);
    expect(result.notes.join('\n')).toMatch(/geração por IA falhou/);
  });

  it('capa faltando não impede as imagens do corpo de existirem', async () => {
    const vision = fakeVision([{ text: pick(-1) }, { text: pick(0) }, { text: pick(1) }]);
    const { result } = await run({ llmVision: vision });
    expect(result.coverMissing).toBe(true);
    expect(result.inline.length).toBeGreaterThan(0);
  });
});

describe('illustrateArticle: orçamento', () => {
  it('orçamento esgotado interrompe sem lançar', async () => {
    const vision = fakeVision([{ text: pick(0) }]);
    const { result } = await run({
      llmVision: vision,
      checkBudget: () => {
        throw new BudgetExceededError('sem orçamento');
      },
    });
    expect(result.status).toBe('budget_exceeded');
    expect(vision.calls).toHaveLength(0);
  });
});

describe('buildGenerationPrompt', () => {
  const slot: ImageSlot = {
    id: 'inline-1',
    role: 'inline',
    description: 'Imagem do corpo do artigo "GTA 6", logo após este trecho: Mapa e cidades: Vice City volta com bairros novos.',
    heading: 'Mapa e cidades',
    query: 'q',
    size: SIZE,
    allowText: false,
  };

  it('pede imagem sem texto por padrão e descreve o trecho ilustrado', () => {
    const prompt = buildGenerationPrompt(slot, 'GTA 6');
    expect(prompt).toMatch(/No text/i);
    expect(prompt).toMatch(/Vice City volta com bairros novos/);
    expect(prompt).toMatch(/landscape/i);
  });

  it('permite texto só quando o slot autoriza', () => {
    expect(buildGenerationPrompt({ ...slot, allowText: true }, 'GTA 6')).toMatch(/only if essential/i);
  });

  it('formato retrato quando o slot é mais alto que largo', () => {
    expect(buildGenerationPrompt({ ...slot, size: { width: 720, height: 1280 } }, 'GTA 6')).toMatch(/portrait/i);
  });
});

describe('illustrateArticle: alt', () => {
  it('alt vazio do modelo cai no tópico', async () => {
    const { result } = await run({ llmVision: fakeVision([{ text: pick(0, '') }]) }, { inlineCount: 0 });
    expect(result.cover?.alt).toBe('GTA 6');
  });
});

describe('buildLlmRequest com imagens', () => {
  it('anthropic usa blocos image source url; openai usa image_url', async () => {
    const { buildLlmRequest } = await import('../src/llm/request');
    const schema = { type: 'object' } as Record<string, unknown>;
    const anthropic = buildLlmRequest(
      { provider: 'anthropic', model: 'm', apiKey: 'k' },
      'texto',
      schema,
      'n',
      100,
      0,
      ['https://img/1.jpg'],
    );
    const aMsg = (anthropic.body.messages as Array<{ content: unknown }>)[0]!.content as Array<Record<string, unknown>>;
    expect(aMsg[1]!.type).toBe('image');
    expect((aMsg[1]!.source as Record<string, unknown>).url).toBe('https://img/1.jpg');

    const openai = buildLlmRequest(
      { provider: 'openai', model: 'm', apiKey: 'k' },
      'texto',
      schema,
      'n',
      100,
      0,
      ['https://img/1.jpg'],
    );
    const oMsg = (openai.body.messages as Array<{ content: unknown }>)[0]!.content as Array<Record<string, unknown>>;
    expect(oMsg[1]!.type).toBe('image_url');
  });
});

describe('buildLlmRequest com imagens em base64', () => {
  const schema = { type: 'object' } as Record<string, unknown>;
  const DATA = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

  it('anthropic recebe base64 como source base64, e URL comum continua como url', async () => {
    const { buildLlmRequest } = await import('../src/llm/request');
    const req = buildLlmRequest({ provider: 'anthropic', model: 'm', apiKey: 'k' }, 'texto', schema, 'n', 100, 0, [
      DATA,
      'https://img/1.jpg',
    ]);
    const content = (req.body.messages as Array<{ content: unknown }>)[0]!.content as Array<Record<string, unknown>>;
    expect(content[1]!.source).toEqual({ type: 'base64', media_type: 'image/jpeg', data: '/9j/4AAQSkZJRg==' });
    expect(content[2]!.source).toEqual({ type: 'url', url: 'https://img/1.jpg' });
  });

  it('openai e openrouter aceitam a data URL direto em image_url', async () => {
    const { buildLlmRequest } = await import('../src/llm/request');
    for (const provider of ['openai', 'openrouter'] as const) {
      const req = buildLlmRequest({ provider, model: 'm', apiKey: 'k' }, 'texto', schema, 'n', 100, 0, [DATA]);
      const content = (req.body.messages as Array<{ content: unknown }>)[0]!.content as Array<Record<string, unknown>>;
      expect((content[1]!.image_url as Record<string, unknown>).url).toBe(DATA);
    }
  });

  it('o media type da data URL é respeitado (png, webp)', async () => {
    const { buildLlmRequest } = await import('../src/llm/request');
    const req = buildLlmRequest({ provider: 'anthropic', model: 'm', apiKey: 'k' }, 't', schema, 'n', 100, 0, [
      'data:image/webp;base64,AAAA',
    ]);
    const content = (req.body.messages as Array<{ content: unknown }>)[0]!.content as Array<Record<string, unknown>>;
    expect((content[1]!.source as Record<string, unknown>).media_type).toBe('image/webp');
  });
});
