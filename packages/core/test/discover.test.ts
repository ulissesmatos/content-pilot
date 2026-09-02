import { describe, expect, it } from 'vitest';
import {
  buildDiscoveryQueries,
  isNearDuplicate,
  jaccard,
  runDiscovery,
  titleTokens,
  type DiscoveryDeps,
  type DiscoveryInput,
} from '../src/autopilot/discover';
import type { LlmCompleteRequest, LlmCompleteResult, LlmProvider } from '../src/llm/types';
import type { SearchClient } from '../src/search/tavily';

function fakeLlm(responses: Array<Partial<LlmCompleteResult> | Error>): LlmProvider & { calls: LlmCompleteRequest[] } {
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
        inputTokens: 100,
        outputTokens: 50,
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

const fakeSearch: SearchClient = {
  async search() {
    return {
      results: [
        { title: 'Blox Fruits update 25', url: 'https://a.com/1', content: 'novo update saiu', published_date: '2026-07-01' },
        { title: 'Grow a Garden codes', url: 'https://b.com/2', content: 'novos códigos' },
      ],
    };
  },
  async extract(urls) {
    return { results: urls.map((url) => ({ url })), failed_results: [] };
  },
};

function baseInput(over: Partial<DiscoveryInput> = {}): DiscoveryInput {
  return {
    seedTopics: ['Roblox codes', 'jogos mobile'],
    language: 'pt-BR',
    siteName: 'DeepGames',
    existingTitles: [],
    postsPerCycle: 3,
    ...over,
  };
}

describe('titleTokens / jaccard', () => {
  it('remove acentos, stopwords e códigos-ruído', () => {
    const t = titleTokens('Códigos de Blox Fruits (Julho)');
    expect(t.has('blox')).toBe(true);
    expect(t.has('fruits')).toBe(true);
    expect(t.has('codigos')).toBe(false); // stopword de ruído
    expect(t.has('de')).toBe(false);
  });

  it('jaccard 1 para conjuntos iguais, 0 para disjuntos', () => {
    expect(jaccard(titleTokens('Blox Fruits'), titleTokens('Blox Fruits'))).toBe(1);
    expect(jaccard(titleTokens('Blox Fruits'), titleTokens('Anime Vanguards'))).toBe(0);
  });
});

describe('isNearDuplicate', () => {
  it('detecta título quase idêntico (só o filtro barato; a variação de mês é papel do LLM)', () => {
    const dup = isNearDuplicate('Códigos Blox Fruits julho 2026', ['Códigos de Blox Fruits (julho de 2026)']);
    expect(dup).toBeTruthy();
  });
  it('não marca variação sutil (mês diferente) — deixa para o dedup semântico', () => {
    // julho vs junho: Jaccard abaixo do threshold conservador; o LLM decide
    expect(isNearDuplicate('Códigos Blox Fruits julho', ['Códigos de Blox Fruits (junho de 2026)'])).toBeNull();
  });
  it('não marca temas distintos', () => {
    expect(isNearDuplicate('Códigos Anime Vanguards', ['Códigos Blox Fruits'])).toBeNull();
  });
});

describe('buildDiscoveryQueries', () => {
  it('gera queries pt por semente', () => {
    const qs = buildDiscoveryQueries(['Roblox codes'], 'pt-BR', new Date('2026-07-09'));
    expect(qs.length).toBe(2);
    expect(qs[0]).toContain('Roblox codes');
    expect(qs.some((q) => q.includes('pesquisando'))).toBe(true);
  });
  it('limita a 5 sementes', () => {
    const qs = buildDiscoveryQueries(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 'en-US', new Date());
    expect(qs.length).toBe(10);
  });
});

describe('runDiscovery', () => {
  const candidatesJson = JSON.stringify({
    candidates: [
      { topic: 'Códigos Blox Fruits julho 2026', contentType: 'evergreen', keywords: ['blox fruits codes'], angle: 'x', suggestedTitle: 'Códigos Blox Fruits (Julho 2026)' },
      { topic: 'Códigos Grow a Garden', contentType: 'list', keywords: ['grow a garden codes'], angle: 'y', suggestedTitle: 'Códigos Grow a Garden' },
    ],
  });

  it('classifica e mantém candidatos quando não há posts existentes', async () => {
    const llm = fakeLlm([{ text: candidatesJson }]);
    const deps: DiscoveryDeps = { search: fakeSearch, llmDiscover: llm };
    const res = await runDiscovery(baseInput(), deps);
    expect(res.status).toBe('ok');
    expect(res.kept.length).toBe(2);
    // sem existingTitles, o dedup LLM não roda → só 1 chamada (discover)
    expect(llm.calls.length).toBe(1);
  });

  it('dedup determinístico descarta duplicata antes do LLM', async () => {
    const llm = fakeLlm([{ text: candidatesJson }, { text: JSON.stringify({ decisions: [] }) }]);
    const deps: DiscoveryDeps = { search: fakeSearch, llmDiscover: llm };
    const res = await runDiscovery(baseInput({ existingTitles: ['Códigos de Blox Fruits (junho de 2026)'] }), deps);
    // Blox Fruits cai no determinístico; Grow a Garden sobrevive
    const blox = res.discarded.find((d) => d.topic.includes('Blox Fruits'));
    expect(blox).toBeTruthy();
    expect(res.kept.some((c) => c.topic.includes('Grow a Garden'))).toBe(true);
  });

  it('dedup LLM marca keep=false (candidato na banda de incerteza)', async () => {
    const dedupeJson = JSON.stringify({ decisions: [{ index: 0, keep: false, reason: 'já coberto' }] });
    const llm = fakeLlm([{ text: candidatesJson }, { text: dedupeJson }]);
    const deps: DiscoveryDeps = { search: fakeSearch, llmDiscover: llm };
    // 'Códigos Blox Fruits de junho' vs 'Códigos Blox Fruits julho 2026':
    // parecido o bastante para ser incerto (>= 0.25), mas abaixo do corte
    // determinístico (0.6) → vai para o LLM, que descarta.
    const res = await runDiscovery(baseInput({ existingTitles: ['Códigos Blox Fruits de junho'] }), deps);
    expect(llm.calls.length).toBe(2);
    expect(res.kept.length).toBe(1);
    expect(res.kept[0]!.topic).toContain('Grow a Garden');
    expect(res.discarded.some((d) => d.reason === 'já coberto')).toBe(true);
  });

  it('economiza a chamada de dedup quando nenhum candidato é incerto', async () => {
    const llm = fakeLlm([{ text: candidatesJson }]);
    const deps: DiscoveryDeps = { search: fakeSearch, llmDiscover: llm };
    // títulos existentes sem nenhuma relação → todos claramente novos
    const res = await runDiscovery(baseInput({ existingTitles: ['Guia de Fortnite'] }), deps);
    expect(res.kept.length).toBe(2);
    // só a chamada de descoberta — o dedup semântico foi pulado
    expect(llm.calls.length).toBe(1);
  });

  it('respeita postsPerCycle', async () => {
    const llm = fakeLlm([{ text: candidatesJson }]);
    const deps: DiscoveryDeps = { search: fakeSearch, llmDiscover: llm };
    const res = await runDiscovery(baseInput({ postsPerCycle: 1 }), deps);
    expect(res.kept.length).toBe(1);
  });

  it('filtra por allowedTypes', async () => {
    const llm = fakeLlm([{ text: candidatesJson }]);
    const deps: DiscoveryDeps = { search: fakeSearch, llmDiscover: llm };
    const res = await runDiscovery(baseInput({ allowedTypes: ['list'] }), deps);
    expect(res.kept.every((c) => c.contentType === 'list')).toBe(true);
    expect(res.kept.length).toBe(1);
  });

  it('LLM de descoberta falha → status llm_failed', async () => {
    const { LlmError } = await import('../src/llm/client');
    const llm = fakeLlm([new LlmError('boom')]);
    const deps: DiscoveryDeps = { search: fakeSearch, llmDiscover: llm };
    const res = await runDiscovery(baseInput(), deps);
    expect(res.status).toBe('llm_failed');
    expect(res.kept.length).toBe(0);
  });

  it('dedup LLM falha → passthrough (mantém do determinístico)', async () => {
    const { LlmError } = await import('../src/llm/client');
    const llm = fakeLlm([{ text: candidatesJson }, new LlmError('dedupe down')]);
    const deps: DiscoveryDeps = { search: fakeSearch, llmDiscover: llm };
    const res = await runDiscovery(baseInput({ existingTitles: ['Guia de Fortnite'] }), deps);
    expect(res.status).toBe('ok');
    expect(res.kept.length).toBe(2); // passthrough
  });

  it('sem candidatos válidos → no_candidates', async () => {
    const llm = fakeLlm([{ text: JSON.stringify({ candidates: [] }) }]);
    const deps: DiscoveryDeps = { search: fakeSearch, llmDiscover: llm };
    const res = await runDiscovery(baseInput(), deps);
    expect(res.status).toBe('no_candidates');
  });

  it('tolera nomes de campo alternativos (topics/theme/type) de modelos em json_object', async () => {
    // Regressão real: OpenRouter/deepseek em json_object nomeou a lista "topics"
    // e o campo "theme"/"type" em vez de candidates/topic/contentType.
    const altShape = JSON.stringify({
      topics: [
        { theme: 'Jogos do PS Plus de julho', type: 'news', keywords: ['ps plus julho'], angle: 'x', suggestedTitle: 'PS Plus Julho 2026' },
        { theme: 'Códigos de Dress to Impress', type: 'list', keywords: ['dti codes'], angle: 'y', suggestedTitle: 'Códigos DTI' },
      ],
    });
    const llm = fakeLlm([{ text: altShape }]);
    const deps: DiscoveryDeps = { search: fakeSearch, llmDiscover: llm };
    const res = await runDiscovery(baseInput({ postsPerCycle: 5 }), deps);
    expect(res.status).toBe('ok');
    expect(res.kept.length).toBe(2);
    expect(res.kept[0]!.contentType).toBe('news');
    expect(res.kept[1]!.contentType).toBe('list');
  });
});
