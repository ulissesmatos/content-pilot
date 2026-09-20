import { describe, expect, it } from 'vitest';
import { acceptRevision, findAiTells, reviewArticle, type ReviewInput } from '../src/pipeline/review';
import type { LlmCompleteRequest, LlmCompleteResult, LlmProvider } from '../src/llm/types';
import { planImageSlots } from '../src/images/slots';
import { isReviewEnabled, parseTemplateConfig } from '../src/templates/schema';
import { gameCodesTemplate } from '../src/templates/seeds/game-codes';
import { genericArticleTemplate } from '../src/templates/seeds/generic-article';
import { BudgetExceededError } from '../src/pipeline/types';

const P = (t: string) => `<!-- wp:paragraph --><p>${t}</p><!-- /wp:paragraph -->`;
const H = (t: string) => `<!-- wp:heading {"level":3} --><h3 class="wp-block-heading">${t}</h3><!-- /wp:heading -->`;

const ORIGINAL = [
  P('No mundo atual, o Roblox lançou uma nova aba de chat entre amigos que já conta com mais de 150 milhões de usuários ativos por mês.'),
  H('Como ativar'),
  P('Abra o aplicativo e toque em <a href="https://ign.com/roblox-chat">amigos</a>. Depois escolha quem vai conversar com você.'),
  P('É importante destacar que o recurso chegou primeiro ao celular, e só depois ao computador, segundo a própria empresa.'),
  H('Segurança'),
  P('Os pais podem limitar quem fala com os filhos. Em resumo, o controle fica nas configurações da conta.'),
].join('');

const CONTEXT = 'O Roblox tem 150 milhões de usuários ativos por mês. O recurso chegou ao celular primeiro.';
const STYLE = { noDashes: true, datePolicy: 'avoid' as const };

const GOOD_REVISION = [
  P('O Roblox lançou uma aba de chat entre amigos, recurso que já alcança mais de 150 milhões de usuários ativos por mês.'),
  H('Como ativar'),
  P('Abra o aplicativo e toque em <a href="https://ign.com/roblox-chat">amigos</a>. Escolha quem vai conversar com você.'),
  P('O recurso chegou primeiro ao celular e depois ao computador, segundo a própria empresa, o que prioriza quem joga no telefone.'),
  H('Segurança'),
  P('Os pais podem limitar quem fala com os filhos, e todo o controle fica nas configurações da conta, sem precisar de aplicativo extra.'),
].join('');

function llm(reply: object | string | Error): LlmProvider & { calls: LlmCompleteRequest[] } {
  const calls: LlmCompleteRequest[] = [];
  return {
    provider: 'openai',
    model: 'gpt-5.4-mini',
    calls,
    async complete(req) {
      calls.push(req);
      if (reply instanceof Error) throw reply;
      return {
        text: typeof reply === 'string' ? reply : JSON.stringify(reply),
        inputTokens: 100,
        outputTokens: 50,
        costUsd: null,
        truncated: false,
        provider: 'openai',
        model: 'gpt-5.4-mini',
        durationMs: 1,
      } satisfies LlmCompleteResult;
    },
  };
}

const input = (over: Partial<ReviewInput> = {}): ReviewInput => ({
  topic: 'chat entre amigos do Roblox',
  title: 'Chat entre amigos do Roblox',
  html: ORIGINAL,
  language: 'pt-BR',
  context: CONTEXT,
  style: STYLE,
  maxTokens: 8000,
  ...over,
});

const reply = (revisedHtml: string, extra: Record<string, unknown> = {}) => ({
  revisedHtml,
  changes: [{ kind: 'ai_tone', section: 'abertura', note: 'tirei "No mundo atual"' }],
  imageHints: [{ afterHeading: 'Como ativar', description: 'tela da aba de amigos no aplicativo' }],
  ...extra,
});

describe('acceptRevision: o que protege o artigo de um revisor descuidado', () => {
  it('aceita uma revisão boa', () => {
    expect(acceptRevision(ORIGINAL, GOOD_REVISION, CONTEXT)).toEqual({ ok: true });
  });

  it('rejeita quando um link some', () => {
    const lost = GOOD_REVISION.replace('<a href="https://ign.com/roblox-chat">amigos</a>', 'amigos');
    const r = acceptRevision(ORIGINAL, lost, CONTEXT);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/perdeu 1 link/);
  });

  it('rejeita número inventado, que é a alucinação mais perigosa', () => {
    const invented = GOOD_REVISION.replace('150 milhões', '300 milhões');
    const r = acceptRevision(ORIGINAL, invented, CONTEXT);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/número.*300|300/);
  });

  it('aceita número que está nas fontes mesmo que não esteja no rascunho', () => {
    const fromSource = GOOD_REVISION.replace('mais de 150 milhões', 'mais de 150 milhões e um recurso que chegou ao celular primeiro');
    expect(acceptRevision(ORIGINAL, fromSource, CONTEXT).ok).toBe(true);
    // 1.500 e 1500 são o mesmo número
    expect(acceptRevision(P('Custa 1.500 reais.'.repeat(30)), P('Custa 1500 reais.'.repeat(30)), '').ok).toBe(true);
  });

  it('rejeita quando "revisar" virou "resumir"', () => {
    const short = [P('O Roblox lançou um chat.'), H('Como ativar'), P('Abra o app.'), H('Segurança'), P('Há controle.')].join('');
    const r = acceptRevision(ORIGINAL, short + P('x'.repeat(200)), CONTEXT);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/encolheu/);
  });

  it('rejeita divagação (texto inflado demais)', () => {
    const r = acceptRevision(ORIGINAL, GOOD_REVISION + P('mais um parágrafo enorme. '.repeat(120)), CONTEXT);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/inflou/);
  });

  it('rejeita título de seção removido e parágrafos juntados demais', () => {
    const noHeading = GOOD_REVISION.replace(H('Segurança'), '');
    expect(acceptRevision(ORIGINAL, noHeading, CONTEXT).ok).toBe(false);
  });

  it('rejeita o que quebraria o post: bloco desbalanceado, script, cerca de código, sem Gutenberg', () => {
    expect(acceptRevision(ORIGINAL, GOOD_REVISION + '<!-- wp:paragraph --><p>aberto</p>', CONTEXT).ok).toBe(false);
    expect(acceptRevision(ORIGINAL, GOOD_REVISION + '<script>x()</script>', CONTEXT).ok).toBe(false);
    expect(acceptRevision(ORIGINAL, '```html\n' + GOOD_REVISION + '\n```', CONTEXT).ok).toBe(false);
    expect(acceptRevision(ORIGINAL, '<p>' + 'texto '.repeat(60) + '</p>', CONTEXT).ok).toBe(false);
    expect(acceptRevision(ORIGINAL, '', CONTEXT).ok).toBe(false);
  });
});

describe('reviewArticle', () => {
  it('aceita a revisão boa, devolve as mudanças e as dicas de imagem', async () => {
    const r = await reviewArticle(input(), { llm: llm(reply(GOOD_REVISION)), log: () => {} });
    expect(r.status).toBe('revised');
    expect(r.html).toBe(GOOD_REVISION);
    expect(r.changes).toEqual([{ kind: 'ai_tone', section: 'abertura', note: 'tirei "No mundo atual"' }]);
    expect(r.imageHints).toEqual([{ afterHeading: 'Como ativar', description: 'tela da aba de amigos no aplicativo' }]);
    expect(r.llmCalls[0]).toMatchObject({ purpose: 'review', status: 'ok' });
  });

  it('revisão perigosa é descartada e o texto ORIGINAL segue, com o motivo', async () => {
    const logs: string[] = [];
    const bad = GOOD_REVISION.replace('150 milhões', '999 milhões');
    const r = await reviewArticle(input(), { llm: llm(reply(bad)), log: (m) => logs.push(m) });
    expect(r.status).toBe('rejected');
    expect(r.html).toBe(ORIGINAL);
    expect(r.reason).toMatch(/999/);
    expect(logs.join(' ')).toMatch(/descartada/);
    // mesmo descartada, a sugestão de imagem ainda ajuda
    expect(r.imageHints).toHaveLength(1);
  });

  it('o revisor que reintroduz travessão é corrigido antes de qualquer checagem', async () => {
    const dashed = GOOD_REVISION.replace('O Roblox lançou uma aba', 'O Roblox — gigante do nicho — lançou uma aba');
    const r = await reviewArticle(input(), { llm: llm(reply(dashed)), log: () => {} });
    expect(r.status).toBe('revised');
    expect(r.html).not.toMatch(/[—–]/);
  });

  it('falha de chamada não derruba o post: o original segue', async () => {
    const { LlmError } = await import('../src/llm/client');
    const r = await reviewArticle(input(), { llm: llm(new LlmError('HTTP 429')), log: () => {} });
    expect(r.status).toBe('failed');
    expect(r.html).toBe(ORIGINAL);
    expect(r.reason).toMatch(/429/);
    expect(r.llmCalls[0]).toMatchObject({ status: 'error' });
  });

  it('resposta truncada nunca é publicada pela metade', async () => {
    const truncating: LlmProvider = {
      provider: 'openai', model: 'm',
      async complete() {
        return { text: '{"revisedHtml":"<!-- wp:paragraph --><p>corta', inputTokens: 1, outputTokens: 1, costUsd: null, truncated: true, provider: 'openai', model: 'm', durationMs: 1 };
      },
    };
    const r = await reviewArticle(input(), { llm: truncating, log: () => {} });
    expect(r.status).toBe('rejected');
    expect(r.html).toBe(ORIGINAL);
  });

  it('JSON inválido ou sem revisedHtml: mantém o original', async () => {
    expect((await reviewArticle(input(), { llm: llm('isto nao e json'), log: () => {} })).html).toBe(ORIGINAL);
    expect((await reviewArticle(input(), { llm: llm({ changes: [], imageHints: [] }), log: () => {} })).status).toBe('rejected');
  });

  it('revisor que devolve o mesmo texto: unchanged, sem ruído', async () => {
    const r = await reviewArticle(input(), { llm: llm(reply(ORIGINAL, { changes: [] })), log: () => {} });
    expect(r.status).toBe('unchanged');
  });

  it('orçamento esgotado não chama o modelo', async () => {
    const model = llm(reply(GOOD_REVISION));
    const r = await reviewArticle(input(), {
      llm: model,
      checkBudget: () => {
        throw new BudgetExceededError('sem orçamento');
      },
    });
    expect(r.status).toBe('budget_exceeded');
    expect(model.calls).toHaveLength(0);
  });

  it('o prompt traz o rascunho, as fontes, as regras duras e a lista de clichês de IA', async () => {
    const model = llm(reply(GOOD_REVISION));
    await reviewArticle(input(), { llm: model, log: () => {} });
    const prompt = model.calls[0]!.prompt;
    expect(prompt).toContain(ORIGINAL.slice(0, 60));
    expect(prompt).toContain(CONTEXT);
    expect(prompt).toMatch(/NÃO invente números/);
    expect(prompt).toMatch(/vale ressaltar/);
    // e as regras de estilo do template também chegam ao revisor
    expect(prompt).toMatch(/travess/i);
  });

  it('tipo de mudança desconhecido vira "other" em vez de quebrar', async () => {
    const r = await reviewArticle(
      input(),
      { llm: llm(reply(GOOD_REVISION, { changes: [{ kind: 'inventado', section: 's', note: 'n' }] })), log: () => {} },
    );
    expect(r.changes[0]!.kind).toBe('other');
  });
});

describe('findAiTells', () => {
  it('acha os vícios do português e do inglês', () => {
    expect(findAiTells('No mundo atual, vale ressaltar que em resumo tudo muda.', 'pt-BR')).toEqual([
      'no mundo atual', 'vale ressaltar', 'em resumo',
    ]);
    expect(findAiTells("In today's world we delve into it", 'en')).toEqual(["in today's world", 'delve']);
  });

  it('texto natural não dispara nada', () => {
    expect(findAiTells('O jogo ganhou um modo cooperativo e o mapa ficou maior.', 'pt-BR')).toEqual([]);
  });

  it('o resultado final informa o que ainda sobrou de vício', async () => {
    const r = await reviewArticle(input(), { llm: llm(reply(GOOD_REVISION)), log: () => {} });
    expect(r.remainingTells).toEqual([]);
    const kept = await reviewArticle(input(), { llm: llm(reply(ORIGINAL, { changes: [] })), log: () => {} });
    expect(kept.remainingTells.length).toBeGreaterThan(0);
  });
});

describe('quando a revisão roda', () => {
  it('artigo revisa; template de dados estruturados (códigos) não', () => {
    expect(isReviewEnabled(parseTemplateConfig(genericArticleTemplate.config))).toBe(true);
    expect(isReviewEnabled(parseTemplateConfig(gameCodesTemplate.config))).toBe(false);
  });

  it('o template pode forçar', () => {
    const on = parseTemplateConfig({ ...gameCodesTemplate.config, review: { enabled: true } });
    const off = parseTemplateConfig({ ...genericArticleTemplate.config, review: { enabled: false } });
    expect(isReviewEnabled(on)).toBe(true);
    expect(isReviewEnabled(off)).toBe(false);
  });
});

describe('dicas do revisor afinam o slot de imagem', () => {
  const size = { width: 1280, height: 720 };
  const slots = planImageSlots({
    topic: 'chat do Roblox', keywords: ['roblox chat'], html: ORIGINAL, inlineCount: 2, coverSize: size, inlineSize: size,
    hints: [{ afterHeading: 'Segurança', description: 'tela de controle parental do aplicativo' }],
  });

  it('a dica da seção entra na descrição e na busca do slot dela', () => {
    const seguranca = slots.find((s) => s.heading === 'Segurança');
    expect(seguranca?.description).toMatch(/controle parental/);
    expect(seguranca?.query).toMatch(/controle|parental/i);
  });

  it('seções sem dica não mudam', () => {
    const other = slots.find((s) => s.role === 'inline' && s.heading !== 'Segurança');
    expect(other).toBeDefined();
    expect(other!.description).not.toMatch(/controle parental/);
  });

  it('a dica GARANTE um slot na seção indicada, mesmo quando a distribuição uniforme não cairia lá', () => {
    // sem dicas, 2 imagens em 4 parágrafos caem nos parágrafos 0 e 2: Segurança (parágrafo 3) ficaria sem imagem
    const withoutHints = planImageSlots({
      topic: 't', keywords: [], html: ORIGINAL, inlineCount: 2, coverSize: size, inlineSize: size,
    });
    expect(withoutHints.some((s) => s.heading === 'Segurança')).toBe(false);
    // com a dica, o slot existe
    expect(slots.some((s) => s.heading === 'Segurança')).toBe(true);
  });

  it('a busca de título ignora caixa e acento', () => {
    const s = planImageSlots({
      topic: 't', keywords: [], html: ORIGINAL, inlineCount: 2, coverSize: size, inlineSize: size,
      hints: [{ afterHeading: 'SEGURANCA', description: 'dica sem acento' }],
    }).find((x) => x.heading === 'Segurança');
    expect(s?.description).toMatch(/dica sem acento/);
  });
});
