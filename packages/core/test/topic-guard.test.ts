import { describe, expect, it } from 'vitest';
import { checkTopicAlreadyCovered } from '../src/autopilot/topic-guard';
import { LlmError } from '../src/llm/client';
import type { LlmCompleteRequest, LlmCompleteResult, LlmProvider } from '../src/llm/types';

function fakeLlm(
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
        inputTokens: 100,
        outputTokens: 20,
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

const decision = (keep: boolean) => JSON.stringify({ decisions: [{ index: 0, keep, reason: 'teste' }] });

describe('checkTopicAlreadyCovered', () => {
  it('sem títulos existentes → não coberto, sem LLM', async () => {
    const llm = fakeLlm([{ text: decision(false) }]);
    const res = await checkTopicAlreadyCovered({ topic: 'Códigos de Blox Fruits julho', existingTitles: [], language: 'pt-BR' }, { llm });
    expect(res.covered).toBe(false);
    expect(llm.calls).toHaveLength(0);
  });

  it('duplicata óbvia é barrada sem gastar LLM (determinístico)', async () => {
    const llm = fakeLlm([{ text: decision(true) }]);
    const res = await checkTopicAlreadyCovered(
      {
        topic: 'Códigos de Blox Fruits atualizados',
        existingTitles: ['Códigos de Blox Fruits atualizados e ativos'],
        language: 'pt-BR',
      },
      { llm },
    );
    expect(res.covered).toBe(true);
    expect(res.method).toBe('deterministic');
    expect(res.matchedTitle).toBe('Códigos de Blox Fruits atualizados e ativos');
    expect(llm.calls).toHaveLength(0);
  });

  it('tema claramente novo nem chama o LLM', async () => {
    const llm = fakeLlm([{ text: decision(false) }]);
    const res = await checkTopicAlreadyCovered(
      { topic: 'Receitas veganas de verão', existingTitles: ['Códigos de Blox Fruits'], language: 'pt-BR' },
      { llm },
    );
    expect(res.covered).toBe(false);
    expect(llm.calls).toHaveLength(0);
  });

  it('banda de incerteza → LLM decide keep=false (coberto, semântico)', async () => {
    const llm = fakeLlm([{ text: decision(false) }]);
    const res = await checkTopicAlreadyCovered(
      {
        topic: 'PlayStation 5 Pro: novidades e destaques',
        existingTitles: ['PlayStation 5: novidades, jogos e preço no Brasil'],
        language: 'pt-BR',
      },
      { llm },
    );
    expect(llm.calls).toHaveLength(1);
    expect(res.covered).toBe(true);
    expect(res.method).toBe('semantic');
    expect(res.matchedTitle).toBe('PlayStation 5: novidades, jogos e preço no Brasil');
    expect(res.llmCalls[0]?.purpose).toBe('dedupe');
  });

  it('banda de incerteza → LLM decide keep=true (não coberto)', async () => {
    const llm = fakeLlm([{ text: decision(true) }]);
    const res = await checkTopicAlreadyCovered(
      {
        topic: 'PlayStation 5 Pro: novidades e destaques',
        existingTitles: ['PlayStation 5: novidades, jogos e preço no Brasil'],
        language: 'pt-BR',
      },
      { llm },
    );
    expect(res.covered).toBe(false);
  });

  it('falha do LLM → fail-open (não bloqueia a geração)', async () => {
    const llm = fakeLlm([new LlmError('down')]);
    const res = await checkTopicAlreadyCovered(
      {
        topic: 'PlayStation 5 Pro: novidades e destaques',
        existingTitles: ['PlayStation 5: novidades, jogos e preço no Brasil'],
        language: 'pt-BR',
      },
      { llm },
    );
    expect(res.covered).toBe(false);
    expect(res.llmCalls[0]?.status).toBe('error');
  });

  it('sem LLM configurado, só a camada determinística roda', async () => {
    const res = await checkTopicAlreadyCovered(
      {
        topic: 'PlayStation 5 Pro: novidades e destaques',
        existingTitles: ['PlayStation 5: novidades, jogos e preço no Brasil'],
        language: 'pt-BR',
      },
      {},
    );
    expect(res.covered).toBe(false);
  });
});
