import { describe, expect, it } from 'vitest';
import { illustrate, type IllustrateDeps } from '../src/images/illustrate';
import type { ImageCandidate, ImageSearchClient } from '../src/images/openverse';
import type { ImageGenClient } from '../src/images/generate';
import type { LlmCompleteRequest, LlmCompleteResult, LlmProvider } from '../src/llm/types';

function fakeImages(n: number): ImageSearchClient {
  const results: ImageCandidate[] = Array.from({ length: n }, (_, i) => ({
    url: `https://img.example/${i}.jpg`,
    thumbnail: `https://img.example/${i}-thumb.jpg`,
    title: `imagem ${i}`,
    license: 'CC-BY 4.0',
    attribution: `Autor ${i} (CC-BY)`,
    sourcePage: `https://src.example/${i}`,
    provider: 'openverse',
  }));
  return { async search() { return results; } };
}

function fakeVision(
  responses: Array<Partial<LlmCompleteResult> | Error>,
): LlmProvider & { calls: LlmCompleteRequest[] } {
  const calls: LlmCompleteRequest[] = [];
  let i = 0;
  return {
    provider: 'openai',
    model: 'gpt-4.1-mini',
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
        model: 'gpt-4.1-mini',
        durationMs: 5,
        ...next,
      };
    },
  };
}

const coverJson = (
  index: number,
  alt = '',
  inline: Array<{ index: number; alt: string }> = [],
  qualityOk?: boolean,
) => JSON.stringify({ cover: { index, alt, ...(qualityOk === undefined ? {} : { qualityOk }) }, inline, reason: 'teste' });

const input = { topic: 'GTA 6', keywords: ['gta 6 trailer'], language: 'pt-BR', maxCandidates: 4 };

function fakeImageGen(result: { data: Uint8Array; mimeType: string } | null): ImageGenClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async generate(prompt) {
      calls.push(prompt);
      return result;
    },
  };
}

describe('illustrate', () => {
  it('escolhe a capa indicada e gera alt', async () => {
    const llmVision = fakeVision([{ text: coverJson(2, 'Cena de GTA 6') }]);
    const deps: IllustrateDeps = { images: fakeImages(4), llmVision };
    const res = await illustrate(input, deps);
    expect(res.status).toBe('ok');
    expect(res.cover?.url).toBe('https://img.example/2.jpg');
    expect(res.cover?.alt).toBe('Cena de GTA 6');
    expect(res.inline).toEqual([]);
    // enviou as miniaturas para o modelo de visão
    expect(llmVision.calls[0]!.images).toHaveLength(4);
  });

  it('escolhe imagens do corpo, sem repetir a capa e respeitando o limite', async () => {
    const llmVision = fakeVision([
      {
        text: coverJson(0, 'Capa', [
          { index: 0, alt: 'repete a capa (ignorada)' },
          { index: 2, alt: 'Corpo A' },
          { index: 3, alt: 'Corpo B' },
          { index: 1, alt: 'excede o limite' },
        ]),
      },
    ]);
    const deps: IllustrateDeps = { images: fakeImages(5), llmVision };
    const res = await illustrate({ ...input, maxCandidates: 5, inlineCount: 2 }, deps);
    expect(res.status).toBe('ok');
    expect(res.cover?.url).toBe('https://img.example/0.jpg');
    expect(res.inline.map((i) => i.url)).toEqual(['https://img.example/2.jpg', 'https://img.example/3.jpg']);
    expect(res.inline.map((i) => i.alt)).toEqual(['Corpo A', 'Corpo B']);
  });

  it('capa -1 mas com imagens de corpo → ok com cover null', async () => {
    const llmVision = fakeVision([{ text: coverJson(-1, '', [{ index: 1, alt: 'Corpo' }]) }]);
    const deps: IllustrateDeps = { images: fakeImages(4), llmVision };
    const res = await illustrate({ ...input, inlineCount: 2 }, deps);
    expect(res.status).toBe('ok');
    expect(res.cover).toBeNull();
    expect(res.inline).toHaveLength(1);
  });

  it('cover.index=-1 e sem corpo → nenhuma imagem relevante (fail-safe)', async () => {
    const deps: IllustrateDeps = {
      images: fakeImages(4),
      llmVision: fakeVision([{ text: coverJson(-1) }]),
    };
    const res = await illustrate(input, deps);
    expect(res.status).toBe('none_relevant');
    expect(res.cover).toBeNull();
  });

  it('índice fora do range → none_relevant (não arrisca imagem errada)', async () => {
    const deps: IllustrateDeps = {
      images: fakeImages(3),
      llmVision: fakeVision([{ text: coverJson(9, 'x') }]),
    };
    const res = await illustrate(input, deps);
    expect(res.status).toBe('none_relevant');
    expect(res.cover).toBeNull();
  });

  it('tolera o formato antigo achatado {index, alt}', async () => {
    const deps: IllustrateDeps = {
      images: fakeImages(3),
      llmVision: fakeVision([{ text: JSON.stringify({ index: 1, alt: 'Antigo', reason: 'ok' }) }]),
    };
    const res = await illustrate(input, deps);
    expect(res.status).toBe('ok');
    expect(res.cover?.url).toBe('https://img.example/1.jpg');
    expect(res.cover?.alt).toBe('Antigo');
  });

  it('qualityOk=false reprova a capa mesmo com índice válido → none_relevant sem gerador', async () => {
    const deps: IllustrateDeps = {
      images: fakeImages(3),
      llmVision: fakeVision([{ text: coverJson(1, 'boa imagem mas com marca d\'água', [], false) }]),
    };
    const res = await illustrate(input, deps);
    expect(res.status).toBe('none_relevant');
    expect(res.cover).toBeNull();
  });

  it('qualityOk=false + imageGen configurado → gera capa com IA', async () => {
    const imageGen = fakeImageGen({ data: new Uint8Array([1, 2, 3]), mimeType: 'image/png' });
    const deps: IllustrateDeps = {
      images: fakeImages(3),
      llmVision: fakeVision([{ text: coverJson(1, 'reprovada', [], false) }]),
      imageGen,
    };
    const res = await illustrate(input, deps);
    expect(res.status).toBe('ok');
    expect(res.coverGenerated).toBe(true);
    expect(res.cover?.provider).toBe('openai-generated');
    expect(res.cover?.inlineData?.data).toEqual(new Uint8Array([1, 2, 3]));
    expect(imageGen.calls).toHaveLength(1);
  });

  it('sem candidatas + imageGen configurado → gera capa com IA em vez de no_candidates', async () => {
    const imageGen = fakeImageGen({ data: new Uint8Array([9]), mimeType: 'image/png' });
    const deps: IllustrateDeps = { images: fakeImages(0), imageGen, llmVision: fakeVision([{ text: '{}' }]) };
    const res = await illustrate(input, deps);
    expect(res.status).toBe('ok');
    expect(res.coverGenerated).toBe(true);
    // não gasta a chamada de visão à toa — nem há candidata para mostrar
    expect((deps.llmVision as ReturnType<typeof fakeVision>).calls.length).toBe(0);
  });

  it('geração de IA falha (retorna null) → cai no comportamento padrão (none_relevant)', async () => {
    const imageGen = fakeImageGen(null);
    const deps: IllustrateDeps = {
      images: fakeImages(3),
      llmVision: fakeVision([{ text: coverJson(-1) }]),
      imageGen,
    };
    const res = await illustrate(input, deps);
    expect(res.status).toBe('none_relevant');
    expect(res.coverGenerated).toBe(false);
  });

  it('sem candidatas → no_candidates (nem chama o LLM)', async () => {
    const llmVision = fakeVision([{ text: '{}' }]);
    const deps: IllustrateDeps = { images: fakeImages(0), llmVision };
    const res = await illustrate(input, deps);
    expect(res.status).toBe('no_candidates');
    expect(llmVision.calls.length).toBe(0);
  });

  it('falha do LLM de visão → llm_failed (post segue sem imagem)', async () => {
    const { LlmError } = await import('../src/llm/client');
    const deps: IllustrateDeps = { images: fakeImages(4), llmVision: fakeVision([new LlmError('vision down')]) };
    const res = await illustrate(input, deps);
    expect(res.status).toBe('llm_failed');
    expect(res.cover).toBeNull();
  });

  it('alt vazio cai no tópico', async () => {
    const deps: IllustrateDeps = {
      images: fakeImages(2),
      llmVision: fakeVision([{ text: coverJson(0) }]),
    };
    const res = await illustrate(input, deps);
    expect(res.cover?.alt).toBe('GTA 6');
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
