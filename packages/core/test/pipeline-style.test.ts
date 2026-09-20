import { describe, expect, it } from 'vitest';
import { runPipeline } from '../src/pipeline/run-pipeline';
import type { LlmCompleteRequest, LlmCompleteResult, LlmProvider } from '../src/llm/types';
import type { SearchClient } from '../src/search/tavily';
import { gameCodesTemplate } from '../src/templates/seeds/game-codes';
import { genericArticleTemplate } from '../src/templates/seeds/generic-article';
import { parseTemplateConfig, resolveStylePolicy } from '../src/templates/schema';

/**
 * Ponta a ponta do pipeline com um LLM que DESOBEDECE as regras de estilo, que
 * é o cenário real: o prompt reduz travessão e data no título, e é a guarda em
 * código que garante o resultado.
 */

const generic = parseTemplateConfig(genericArticleTemplate.config);
const codes = parseTemplateConfig(gameCodesTemplate.config);

const DASHY_HTML =
  '<!-- wp:paragraph --><p>O Roblox — plataforma com milhões de usuários — liberou uma nova aba de chat entre amigos e muita gente ainda não sabe como ativar o recurso no aplicativo.</p><!-- /wp:paragraph -->' +
  '<!-- wp:heading {"level":3} --><h3 class="wp-block-heading">Como ativar – passo a passo</h3><!-- /wp:heading -->' +
  '<!-- wp:paragraph --><p>Abra o app, toque em amigos e escolha a nova aba — é simples e leva poucos segundos para concluir toda a configuração necessária.</p><!-- /wp:paragraph -->';

const BAD_LLM_RESPONSE = JSON.stringify({
  hasChanges: true,
  action: 'update',
  noDataFound: false,
  data: {},
  newTitle: 'Como funciona a nova aba de chat entre amigos do Roblox (20/09/2026): recursos e como testar',
  updatedHtml: DASHY_HTML,
  metaDescription: 'Veja tudo — e aprenda a ativar o novo chat entre amigos do Roblox agora mesmo.',
  category: null,
  changesSummary: 'artigo criado',
});

function fakeLlm(text: string): LlmProvider & { calls: LlmCompleteRequest[] } {
  const calls: LlmCompleteRequest[] = [];
  return {
    provider: 'openai',
    model: 'gpt-x',
    calls,
    async complete(req) {
      calls.push(req);
      return {
        text,
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

async function generate(template: typeof generic, llmText = BAD_LLM_RESPONSE) {
  const llm = fakeLlm(llmText);
  const result = await runPipeline(
    {
      mode: 'generate',
      profile: 'full',
      template,
      language: 'pt-BR',
      topicOverride: 'chat entre amigos do Roblox',
      post: { title: 'chat entre amigos do Roblox', slug: 'chat-roblox' },
    },
    { llmGenerate: llm, llmVerify: llm, search, log: () => {} },
  );
  return { result, llm };
}

describe('política de estilo por template', () => {
  it('artigo genérico evita data; template de códigos permite (data no título é a convenção)', () => {
    expect(resolveStylePolicy(generic)).toEqual({ noDashes: true, datePolicy: 'avoid' });
    expect(resolveStylePolicy(codes)).toEqual({ noDashes: true, datePolicy: 'allow' });
  });

  it('o template pode sobrescrever o padrão', () => {
    const forced = parseTemplateConfig({ ...genericArticleTemplate.config, style: { datePolicy: 'allow', noDashes: false } });
    expect(resolveStylePolicy(forced)).toEqual({ noDashes: false, datePolicy: 'allow' });
  });

  it('template antigo gravado no banco, sem o bloco style, continua válido', () => {
    const { style: _drop, ...legacy } = genericArticleTemplate.config as Record<string, unknown>;
    expect(() => parseTemplateConfig(legacy)).not.toThrow();
  });
});

describe('pipeline de geração com LLM que ignora as regras', () => {
  it('nenhum travessão chega ao HTML final, ao título nem à meta description', async () => {
    const { result } = await generate(generic);
    expect(result.status).toBe('ready');
    expect(result.finalHtml).not.toMatch(/[—–]/);
    expect(result.newTitle).not.toMatch(/[—–]/);
    expect(result.metaDescription).not.toMatch(/[—–]/);
  });

  it('a data decorativa sai do título e o resto do título sobrevive', async () => {
    const { result } = await generate(generic);
    expect(result.newTitle).toBe('Como funciona a nova aba de chat entre amigos do Roblox: recursos e como testar');
  });

  it('preserva a estrutura Gutenberg e o conteúdo ao reescrever', async () => {
    const { result } = await generate(generic);
    const html = result.finalHtml ?? '';
    expect(html.match(/<!-- wp:/g)?.length).toBe(html.match(/<!-- \/wp:/g)?.length);
    expect(html).toContain('<h3 class="wp-block-heading">');
    expect(html).toContain('liberou uma nova aba de chat entre amigos');
  });

  it('anexa as regras de estilo ao prompt enviado ao modelo', async () => {
    const { llm } = await generate(generic);
    const prompt = llm.calls[0]!.prompt;
    expect(prompt).toMatch(/REGRAS DE ESTILO/);
    expect(prompt).toMatch(/travess/i);
    expect(prompt).toMatch(/NÃO coloque data/);
  });

  it('template de códigos mantém a data no título e não pede ao modelo para evitá-la', async () => {
    const titled = JSON.stringify({
      ...JSON.parse(BAD_LLM_RESPONSE),
      newTitle: 'Códigos Blox Fruits (setembro de 2026): lista completa',
      data: { activeCodes: [], expiredCodes: [] },
      noDataFound: true,
    });
    const { llm } = await generate(codes, titled);
    const prompt = llm.calls[0]!.prompt;
    // a regra de datas não é injetada (o próprio prompt do template pede mês/ano)...
    expect(prompt).not.toMatch(/NÃO coloque data/);
    // ...mas a de travessão continua valendo em qualquer template
    expect(prompt).toMatch(/travess/i);
  });
});

describe('modo update não reescreve o texto de um humano', () => {
  it('não aplica a guarda de travessão ao HTML de um post existente', async () => {
    // acima do htmlMinChars (200) do template, senão o teste falharia na validação e não no que ele quer provar
    const existing =
      '<!-- wp:paragraph --><p>Texto escrito pelo autor — com o travessão dele, que ninguém pediu para mexer no post inteiro. ' +
      'O restante do parágrafo existe só para garantir que o HTML passe do tamanho mínimo exigido pela validação do template.</p><!-- /wp:paragraph -->';
    const update = JSON.stringify({
      hasChanges: true,
      action: 'update',
      noDataFound: false,
      data: {},
      newTitle: 'Título do post existente',
      updatedHtml: existing,
      metaDescription: '',
      category: null,
      changesSummary: 'novidade adicionada',
    });
    const llm = fakeLlm(update);
    const result = await runPipeline(
      {
        mode: 'update',
        profile: 'full',
        template: generic,
        language: 'pt-BR',
        post: { id: 1, title: 'Título do post existente', slug: 'x', contentRaw: existing },
      },
      { llmGenerate: llm, llmVerify: llm, search, log: () => {} },
    );
    expect(result.status).toBe('ready');
    expect(result.finalHtml).toContain('—');
  });
});
