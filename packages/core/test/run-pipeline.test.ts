import { describe, expect, it } from 'vitest';
import { runPipeline, type PipelineInput } from '../src/pipeline/run-pipeline';
import type { PipelineDeps } from '../src/pipeline/types';
import type { LlmCompleteRequest, LlmCompleteResult, LlmProvider } from '../src/llm/types';
import type { SearchClient } from '../src/search/tavily';
import { gameCodesTemplate } from '../src/templates/seeds/game-codes';
import { parseTemplateConfig } from '../src/templates/schema';

const cfg = parseTemplateConfig(gameCodesTemplate.config);

const GOOD_HTML =
  '<!-- wp:paragraph --><p>Blox Fruits é um dos jogos mais populares do Roblox e os códigos ativos garantem recompensas valiosas para os jogadores que resgatarem a tempo. Confira o passo a passo completo abaixo.</p><!-- /wp:paragraph --><!-- wp:heading {"level":3} --><h3 class="wp-block-heading">Como resgatar</h3><!-- /wp:heading --><!-- wp:list {"ordered":true} --><ol><li>Abra o jogo</li><li>Clique no ícone de códigos</li><li>Digite o código</li></ol><!-- /wp:list -->';

function fakeLlm(responses: Array<Partial<LlmCompleteResult> | Error>): LlmProvider & { calls: LlmCompleteRequest[] } {
  const calls: LlmCompleteRequest[] = [];
  let i = 0;
  return {
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
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
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        durationMs: 5,
        ...next,
      };
    },
  };
}

function fakeSearch(sourcesText: string): SearchClient {
  return {
    async search() {
      return {
        results: [
          { title: 'Fonte 1', url: 'https://progameguides.com/codes', content: 'resumo um', raw_content: sourcesText },
          { title: 'Fonte 2', url: 'https://tryhardguides.com/codes', content: 'resumo dois', raw_content: sourcesText },
          { title: 'Fonte 3', url: 'https://robloxden.com/codes', content: 'resumo tres', raw_content: sourcesText },
        ],
      };
    },
    async extract(urls) {
      return { results: urls.map((url) => ({ url, raw_content: sourcesText })), failed_results: [] };
    },
  };
}

const GEN_RESPONSE = JSON.stringify({
  hasChanges: true,
  action: 'update',
  noDataFound: false,
  newTitle: 'Códigos Blox Fruits (julho de 2026): lista completa',
  updatedHtml: GOOD_HTML,
  changesSummary: 'Códigos atualizados',
  data: {
    activeCodes: [
      { code: 'FRUIT20', reward: '2x XP', isNew: true, source: 'https://progameguides.com/codes' },
      { code: 'ALUCINADO1', reward: 'gems', isNew: false, source: 'https://x.com' },
    ],
    expiredCodes: [],
  },
});

const VERIFY_APPROVES_ALL = JSON.stringify({
  approved: [
    { list: 'activeCodes', value: 'FRUIT20' },
    { list: 'activeCodes', value: 'ALUCINADO1' },
  ],
  rejected: [],
});

function input(overrides: Partial<PipelineInput> = {}): PipelineInput {
  return {
    mode: 'update',
    template: cfg,
    language: 'pt-BR',
    siteName: 'deepgames.com.br',
    post: {
      id: 1,
      title: 'Códigos Blox Fruits',
      slug: 'codigos-blox-fruits',
      contentRaw: '<!-- wp:paragraph --><p>Post antigo.</p><!-- /wp:paragraph -->',
    },
    ...overrides,
  };
}

describe('runPipeline (integração com fakes)', () => {
  it('caso feliz: gera, verifica, valida e injeta o widget', async () => {
    const llm = fakeLlm([{ text: GEN_RESPONSE }, { text: VERIFY_APPROVES_ALL }]);
    const deps: PipelineDeps = {
      llmGenerate: llm,
      llmVerify: llm,
      search: fakeSearch('códigos ativos hoje: FRUIT20 dá 2x XP por tempo limitado'),
    };
    const r = await runPipeline(input(), deps);

    expect(r.status).toBe('ready');
    // ALUCINADO1 foi aprovado pelo verificador (fake), mas a camada 3 dropou
    expect((r.data.activeCodes as unknown[]).length).toBe(1);
    expect(r.dropped[0]).toMatchObject({ value: 'ALUCINADO1' });
    expect(r.finalHtml).toContain('DG-CODES-WIDGET:START');
    expect(r.finalHtml).toContain('FRUIT20');
    expect(r.finalHtml).not.toContain('ALUCINADO1');
    expect(r.newTitle).toContain('Códigos Blox Fruits');
    expect(r.llmCalls.length).toBe(2);
    expect(r.inputTokens).toBe(200);
    // o tópico derivado corta "Códigos" do título
    expect(llm.calls[0]!.prompt).toContain('"Blox Fruits"');
  });

  it('verificador reprova → itens saem antes da camada 3', async () => {
    const verifyRejects = JSON.stringify({
      approved: [{ list: 'activeCodes', value: 'FRUIT20' }],
      rejected: [{ value: 'ALUCINADO1', reason: 'não aparece nas fontes' }],
    });
    const llm = fakeLlm([{ text: GEN_RESPONSE }, { text: verifyRejects }]);
    const r = await runPipeline(input(), {
      llmGenerate: llm,
      llmVerify: llm,
      search: fakeSearch('códigos: FRUIT20 ativo'),
    });
    expect(r.status).toBe('ready');
    expect((r.data.activeCodes as unknown[]).length).toBe(1);
    expect(r.rejected[0]!.value).toBe('ALUCINADO1');
  });

  it('falha na verificação → passthrough marcado e camada 3 ainda filtra', async () => {
    const llm = fakeLlm([{ text: GEN_RESPONSE }, new (await import('../src/llm/client')).LlmError('api caiu')]);
    const r = await runPipeline(input(), {
      llmGenerate: llm,
      llmVerify: llm,
      search: fakeSearch('códigos: FRUIT20 ativo'),
    });
    expect(r.status).toBe('ready');
    expect(r.verifyFailed).toBe(true);
    expect((r.data.activeCodes as unknown[]).length).toBe(1); // ALUCINADO1 dropado pela camada 3
  });

  it('skip por hash de fontes inalteradas — sem nenhuma chamada LLM', async () => {
    const llm = fakeLlm([{ text: GEN_RESPONSE }]);
    const r = await runPipeline(input(), {
      llmGenerate: llm,
      llmVerify: llm,
      search: fakeSearch('qualquer coisa'),
      shouldSkipSources: () => true,
    });
    expect(r.status).toBe('skipped_sources_unchanged');
    expect(r.sourcesHash).toBeTruthy();
    expect(llm.calls.length).toBe(0);
  });

  it('hash é estável para as mesmas fontes', async () => {
    const llm = fakeLlm([{ text: GEN_RESPONSE }, { text: VERIFY_APPROVES_ALL }]);
    const deps = { llmGenerate: llm, llmVerify: llm, search: fakeSearch('códigos: FRUIT20') };
    const r1 = await runPipeline(input(), deps);
    const r2 = await runPipeline(input(), deps);
    expect(r1.sourcesHash).toBe(r2.sourcesHash);
  });

  it('hasChanges false → no_change', async () => {
    const noChange = JSON.stringify({
      hasChanges: false,
      action: 'update',
      noDataFound: false,
      newTitle: 'Códigos Blox Fruits',
      updatedHtml: '',
      changesSummary: 'Nada novo',
      data: { activeCodes: [], expiredCodes: [] },
    });
    const llm = fakeLlm([{ text: noChange }]);
    const r = await runPipeline(input(), { llmGenerate: llm, llmVerify: llm, search: fakeSearch('x') });
    expect(r.status).toBe('no_change');
    expect(r.changesSummary).toBe('Nada novo');
    expect(llm.calls.length).toBe(1); // verificação não roda
  });

  it('resposta truncada → llm_failed sem publicar', async () => {
    const llm = fakeLlm([{ text: GEN_RESPONSE, truncated: true }]);
    const r = await runPipeline(input(), { llmGenerate: llm, llmVerify: llm, search: fakeSearch('x') });
    expect(r.status).toBe('llm_failed');
    expect(r.skipReason).toContain('truncada');
  });

  it('validação falha → validation_failed com motivos', async () => {
    const badHtml = JSON.stringify({
      ...JSON.parse(GEN_RESPONSE),
      updatedHtml: '<p>sem blocos gutenberg e curto</p>',
    });
    const llm = fakeLlm([{ text: badHtml }, { text: VERIFY_APPROVES_ALL }]);
    const r = await runPipeline(input(), { llmGenerate: llm, llmVerify: llm, search: fakeSearch('FRUIT20') });
    expect(r.status).toBe('validation_failed');
    expect(r.validationErrors.length).toBeGreaterThan(0);
    expect(r.hasChanges).toBe(false);
  });

  it('eco sem mudanças: zero chamadas LLM e widget atualizado com os dados anteriores', async () => {
    const llm = fakeLlm([{ text: GEN_RESPONSE }]);
    const lastData = {
      activeCodes: [{ code: 'FRUIT20', reward: '2x XP', isNew: false, source: 'https://ex.com' }],
      expiredCodes: [],
    };
    const r = await runPipeline(input({ profile: 'eco', lastData }), {
      llmGenerate: llm,
      llmVerify: llm,
      search: fakeSearch('all codes: FRUIT20 still working'),
    });
    expect(r.status).toBe('ready');
    expect(r.action).toBe('widget_refresh');
    expect(llm.calls.length).toBe(0);
    expect(r.inputTokens).toBe(0);
    expect(r.prePass).toMatchObject({ ran: true, changed: false });
    expect(r.finalHtml).toContain('DG-CODES-WIDGET:START');
    expect(r.finalHtml).toContain('FRUIT20');
    expect(r.finalHtml).toContain('Post antigo.'); // conteúdo original preservado
  });

  it('eco com código novo: 1 única chamada LLM (sem verify) com contexto reduzido', async () => {
    const llm = fakeLlm([{ text: GEN_RESPONSE }]);
    const lastData = {
      activeCodes: [{ code: 'OLDCODE7', reward: null, isNew: false, source: 's' }],
      expiredCodes: [],
    };
    const filler = 'texto de enchimento '.repeat(600);
    const r = await runPipeline(input({ profile: 'eco', lastData }), {
      llmGenerate: llm,
      llmVerify: llm,
      search: fakeSearch(`${filler} new codes today: FRUIT20 and OLDCODE7 ${filler}`),
    });
    expect(r.prePass).toMatchObject({ ran: true, changed: true });
    expect(r.status).toBe('ready');
    expect(llm.calls.length).toBe(1); // sem chamada de verificação
    expect(llm.calls[0]!.prompt).toContain('FRUIT20');
    expect(llm.calls[0]!.prompt.length).toBeLessThan(filler.length * 2); // contexto reduzido
    // camada 3 continua ativa: ALUCINADO1 dropado mesmo sem verify
    expect(r.dropped.map((d) => d.value)).toContain('ALUCINADO1');
  });

  it('eco sem lastData (primeira execução): segue direto para a chamada LLM', async () => {
    const llm = fakeLlm([{ text: GEN_RESPONSE }]);
    const r = await runPipeline(input({ profile: 'eco' }), {
      llmGenerate: llm,
      llmVerify: llm,
      search: fakeSearch('códigos: FRUIT20 ativo'),
    });
    expect(r.prePass).toBeNull();
    expect(r.status).toBe('ready');
    expect(llm.calls.length).toBe(1);
  });

  it('eco usa busca basic e pula o extract', async () => {
    const llm = fakeLlm([{ text: GEN_RESPONSE }]);
    const seenOpts: unknown[] = [];
    let extractCalled = false;
    const search: SearchClient = {
      async search(_q, opts) {
        seenOpts.push(opts);
        return {
          results: [{ title: 'F', url: 'https://progameguides.com/x', content: 's', raw_content: 'códigos: FRUIT20' }],
        };
      },
      async extract() {
        extractCalled = true;
        return { results: [], failed_results: [] };
      },
    };
    const r = await runPipeline(input({ profile: 'eco' }), { llmGenerate: llm, llmVerify: llm, search });
    expect(seenOpts[0]).toMatchObject({ depth: 'basic' });
    expect(extractCalled).toBe(false);
    expect(r.extractedResultsCount).toBe(0);
  });

  it('modo generate usa o prompt de geração e força hasChanges', async () => {
    const llm = fakeLlm([{ text: GEN_RESPONSE }, { text: VERIFY_APPROVES_ALL }]);
    const r = await runPipeline(
      input({
        mode: 'generate',
        topicOverride: 'Blox Fruits',
        post: { title: 'Códigos Blox Fruits', slug: 'codigos-blox-fruits' },
        extraInstructions: 'Foque em iniciantes.',
      }),
      { llmGenerate: llm, llmVerify: llm, search: fakeSearch('códigos: FRUIT20') },
    );
    expect(r.status).toBe('ready');
    expect(llm.calls[0]!.prompt).toContain('artigo NOVO');
    expect(llm.calls[0]!.prompt).toContain('Foque em iniciantes.');
  });
});
