import { describe, expect, it } from 'vitest';
import { runPipeline } from '../src/pipeline/run-pipeline';
import type { LlmCompleteRequest, LlmCompleteResult, LlmProvider } from '../src/llm/types';
import type { SearchClient } from '../src/search/tavily';
import { ANGLE_MARKER_EN, ANGLE_MARKER_PT, buildTopicGuidance, parseAngleNote } from '../src/text/topic-guidance';
import { gameCodesTemplate } from '../src/templates/seeds/game-codes';
import { genericArticleTemplate } from '../src/templates/seeds/generic-article';
import { parseTemplateConfig } from '../src/templates/schema';

describe('buildTopicGuidance', () => {
  it('tema sugerido pela descoberta é um norte: pode ajustar o enfoque, sem trocar de assunto', () => {
    const g = buildTopicGuidance({ origin: 'suggested', language: 'pt-BR' });
    expect(g).toMatch(/NORTE, NÃO UMA ORDEM/);
    expect(g).toMatch(/AJUSTE o enfoque e o título/);
    // liberdade tem limite: o mesmo assunto central
    expect(g).toMatch(/não troque de assunto/i);
    expect(g).toMatch(/mesmo tema central/);
    // o título final descreve o texto
    expect(g).toMatch(/newTitle/);
    // e o ajuste deixa rastro
    expect(g).toContain(ANGLE_MARKER_PT);
  });

  it('tema pedido por uma pessoa mantém o assunto e só ajusta o título ao texto', () => {
    const g = buildTopicGuidance({ origin: 'requested', language: 'pt-BR' });
    expect(g).toMatch(/foi pedido por uma pessoa: mantenha-o/);
    expect(g).not.toMatch(/AJUSTE o enfoque/);
    expect(g).toMatch(/newTitle/);
  });

  it('em inglês também, com a marca em inglês', () => {
    const g = buildTopicGuidance({ origin: 'suggested', language: 'en-US' });
    expect(g).toMatch(/COMPASS, NOT AN ORDER/);
    expect(g).toContain(ANGLE_MARKER_EN);
  });

  it('lista os assuntos já cobertos para o ajuste não cair em um deles, limitada a 25', () => {
    const titles = Array.from({ length: 40 }, (_, i) => `Post existente ${i}`);
    const g = buildTopicGuidance({ origin: 'suggested', language: 'pt-BR', avoidTitles: titles });
    expect(g).toMatch(/não repita nenhum deles/);
    expect(g).toContain('Post existente 0');
    expect(g).toContain('Post existente 24');
    expect(g).not.toContain('Post existente 25');
    // sem títulos, sem a seção
    expect(buildTopicGuidance({ origin: 'suggested', language: 'pt-BR' })).not.toMatch(/já cobriu/);
  });
});

describe('parseAngleNote', () => {
  it('lê a nota que o redator deixa no changesSummary, em português ou inglês', () => {
    expect(parseAngleNote('Enfoque ajustado: as fontes mostram que o recurso ainda não saiu, então o texto explica o teste.')).toBe(
      'as fontes mostram que o recurso ainda não saiu, então o texto explica o teste.',
    );
    expect(parseAngleNote('  angle adjusted:  the feature is in beta\nnot released ')).toBe('the feature is in beta not released');
  });

  it('sem a marca, ou vazia, não há ajuste', () => {
    expect(parseAngleNote('artigo criado')).toBeNull();
    expect(parseAngleNote('Enfoque ajustado:   ')).toBeNull();
    expect(parseAngleNote(null)).toBeNull();
    // a marca só vale no começo: uma frase que a cite no meio não conta
    expect(parseAngleNote('artigo criado. Enfoque ajustado: não')).toBeNull();
  });
});

// ---------- no pipeline ----------

const generic = parseTemplateConfig(genericArticleTemplate.config);
const codes = parseTemplateConfig(gameCodesTemplate.config);

const HTML =
  '<!-- wp:paragraph --><p>O Roblox liberou uma nova aba de chat entre amigos e muita gente ainda não sabe como ativar o recurso no aplicativo.</p><!-- /wp:paragraph -->' +
  '<!-- wp:heading {"level":3} --><h3 class="wp-block-heading">Como ativar</h3><!-- /wp:heading -->' +
  '<!-- wp:paragraph --><p>Abra o app, toque em amigos e escolha a nova aba, que leva poucos segundos para concluir toda a configuração necessária.</p><!-- /wp:paragraph -->';

const RESPONSE = JSON.stringify({
  hasChanges: true,
  action: 'update',
  noDataFound: false,
  data: {},
  newTitle: 'Chat entre amigos do Roblox: como ativar',
  updatedHtml: HTML,
  metaDescription: 'Veja como ativar o chat entre amigos do Roblox.',
  category: null,
  changesSummary: 'artigo criado',
});

function fakeLlm(): LlmProvider & { calls: LlmCompleteRequest[] } {
  const calls: LlmCompleteRequest[] = [];
  return {
    provider: 'openai',
    model: 'gpt-x',
    calls,
    async complete(req) {
      calls.push(req);
      return {
        text: RESPONSE,
        inputTokens: 10,
        outputTokens: 10,
        costUsd: null,
        truncated: false,
        provider: 'openai',
        model: 'gpt-x',
        durationMs: 1,
      } satisfies LlmCompleteResult;
    },
  };
}

const search: SearchClient = {
  async search() {
    return {
      results: [
        { title: 'F1', url: 'https://a.com/1', content: 'x', raw_content: 'texto fonte um sobre roblox chat' },
        { title: 'F2', url: 'https://b.com/2', content: 'x', raw_content: 'texto fonte dois sobre roblox chat' },
      ],
    };
  },
  async extract(urls) {
    return { results: urls.map((url) => ({ url, raw_content: 'conteudo' })), failed_results: [] };
  },
};

async function promptFor(template: typeof generic, extra: Record<string, unknown> = {}) {
  const llm = fakeLlm();
  await runPipeline(
    {
      mode: 'generate',
      profile: 'full',
      template,
      language: 'pt-BR',
      topicOverride: 'chat entre amigos do Roblox',
      post: { title: 'chat entre amigos do Roblox', slug: 'chat-roblox' },
      ...extra,
    },
    { llmGenerate: llm, llmVerify: llm, search, log: () => {} },
  );
  return llm.calls[0]!.prompt;
}

describe('a orientação do tema no prompt de geração', () => {
  it('tema da descoberta: o redator recebe a liberdade de ajustar, e os títulos que não pode repetir', async () => {
    const prompt = await promptFor(generic, { topicOrigin: 'suggested', avoidTitles: ['Como usar o chat do Roblox'] });
    expect(prompt).toMatch(/NORTE, NÃO UMA ORDEM/);
    expect(prompt).toContain('Como usar o chat do Roblox');
    // vem DEPOIS do texto do template e das regras de estilo, para valer sobre "escreva um artigo sobre"
    expect(prompt.indexOf('NORTE, NÃO UMA ORDEM')).toBeGreaterThan(prompt.indexOf('REGRAS DE ESTILO'));
  });

  it('sem informar a origem, vale a de pedido manual: o assunto é mantido', async () => {
    const prompt = await promptFor(generic);
    expect(prompt).toMatch(/foi pedido por uma pessoa/);
    expect(prompt).not.toMatch(/NORTE, NÃO UMA ORDEM/);
  });

  it('template de dados estruturados nunca recebe a liberdade: o assunto está amarrado ao que é extraído', async () => {
    const prompt = await promptFor(codes as unknown as typeof generic, { topicOrigin: 'suggested' });
    expect(prompt).not.toMatch(/NORTE, NÃO UMA ORDEM/);
    expect(prompt).not.toMatch(/foi pedido por uma pessoa/);
  });

  it('atualização de post existente não recebe: só a geração de artigo novo', async () => {
    const llm = fakeLlm();
    await runPipeline(
      {
        mode: 'update',
        profile: 'full',
        template: generic,
        language: 'pt-BR',
        topicOrigin: 'suggested',
        post: { id: 1, title: 'Chat do Roblox', slug: 'chat', contentRaw: HTML },
      },
      { llmGenerate: llm, llmVerify: llm, search, log: () => {} },
    );
    expect(llm.calls[0]!.prompt).not.toMatch(/NORTE, NÃO UMA ORDEM|foi pedido por uma pessoa/);
  });
});
