import { describe, expect, it } from 'vitest';
import { acceptTitle, reviewArticle, type ReviewInput } from '../src/pipeline/review';
import type { LlmCompleteRequest, LlmCompleteResult, LlmProvider } from '../src/llm/types';

/**
 * O revisor vê o texto inteiro e pode achar um título que casa melhor com ele. As guardas
 * existem porque um título é a parte mais fácil de o modelo enfeitar: número que o texto não
 * tem, outro assunto, marcação, tamanho fora do que o template aceita.
 */

const P = (t: string) => `<!-- wp:paragraph --><p>${t}</p><!-- /wp:paragraph -->`;
const H = (t: string) => `<!-- wp:heading {"level":3} --><h3 class="wp-block-heading">${t}</h3><!-- /wp:heading -->`;

const ORIGINAL = [
  P('O Roblox lançou uma nova aba de chat entre amigos que já conta com mais de 150 milhões de usuários ativos por mês, segundo a empresa.'),
  H('Como ativar'),
  P('Abra o aplicativo e toque em <a href="https://ign.com/roblox-chat">amigos</a>. Depois escolha quem vai conversar com você.'),
  P('O recurso chegou primeiro ao celular, e só depois ao computador, segundo a própria empresa em comunicado oficial.'),
  H('Segurança'),
  P('Os pais podem limitar quem fala com os filhos, e o controle fica nas configurações da conta, sem precisar de aplicativo extra.'),
].join('');
const CONTEXT = 'O Roblox tem 150 milhões de usuários ativos por mês. O recurso chegou ao celular primeiro. A empresa lançou 3 controles para pais.';
const STYLE = { noDashes: true, datePolicy: 'avoid' as const };

// revisão boa e segura: só afina o texto
const GOOD_REVISION = ORIGINAL.replace('O Roblox lançou uma nova aba', 'O Roblox lançou uma aba').replace(
  'e o controle fica nas configurações da conta',
  'e todo o controle fica nas configurações da conta',
);

function llm(reply: object): LlmProvider & { calls: LlmCompleteRequest[] } {
  const calls: LlmCompleteRequest[] = [];
  return {
    provider: 'openai',
    model: 'gpt-x',
    calls,
    async complete(req) {
      calls.push(req);
      return {
        text: JSON.stringify(reply),
        inputTokens: 1,
        outputTokens: 1,
        costUsd: null,
        truncated: false,
        provider: 'openai',
        model: 'gpt-x',
        durationMs: 1,
      } satisfies LlmCompleteResult;
    },
  };
}

const input = (over: Partial<ReviewInput> = {}): ReviewInput => ({
  topic: 'chat entre amigos do Roblox',
  title: 'Roblox lança chat entre amigos',
  html: ORIGINAL,
  language: 'pt-BR',
  context: CONTEXT,
  style: STYLE,
  maxTokens: 8000,
  titleMin: 10,
  titleMax: 120,
  ...over,
});

const reply = (over: Record<string, unknown> = {}) => ({
  revisedHtml: GOOD_REVISION,
  revisedTitle: 'Roblox lança chat entre amigos',
  titleReason: '',
  changes: [],
  imageHints: [],
  ...over,
});

const ctx = { topic: 'chat entre amigos do Roblox', html: ORIGINAL, context: CONTEXT, style: STYLE };

describe('acceptTitle', () => {
  it('aceita um título que casa melhor e continua no assunto', () => {
    expect(acceptTitle('Roblox lança chat entre amigos', 'Como ativar o chat entre amigos do Roblox no celular e no computador', ctx)).toEqual({
      ok: true,
      title: 'Como ativar o chat entre amigos do Roblox no celular e no computador',
    });
  });

  it('título igual (ignorando caixa e espaços) ou vazio: sem mudança, e sem motivo de recusa', () => {
    expect(acceptTitle('Roblox lança chat entre amigos', '  roblox lança   CHAT entre amigos ', ctx)).toEqual({ ok: false, reason: null });
    expect(acceptTitle('Roblox lança chat entre amigos', '', ctx)).toEqual({ ok: false, reason: null });
  });

  it('número que não está no texto nem nas fontes é recusado; o que está, passa', () => {
    const bad = acceptTitle('Roblox lança chat entre amigos', '99 dicas do chat entre amigos do Roblox', ctx);
    expect(bad).toMatchObject({ ok: false });
    expect((bad as { reason: string }).reason).toMatch(/99/);
    // 150 está no texto, e 3 (1 dígito) nem é checado
    expect(acceptTitle('Roblox lança chat entre amigos', 'Chat entre amigos chega a 150 milhões de usuários do Roblox', ctx)).toMatchObject({ ok: true });
  });

  it('outro assunto é recusado', () => {
    const r = acceptTitle('Roblox lança chat entre amigos', 'Guia completo de investimentos para iniciantes', ctx);
    expect(r).toEqual({ ok: false, reason: 'o novo título mudou de assunto' });
  });

  it('marcação, várias linhas e tamanho fora do limite do template são recusados', () => {
    expect(acceptTitle('Roblox lança chat entre amigos', '<b>Chat do Roblox</b> entre amigos', ctx)).toMatchObject({ ok: false });
    expect(acceptTitle('Roblox lança chat entre amigos', '# Chat do Roblox entre amigos', ctx)).toMatchObject({ ok: false });
    expect(acceptTitle('Roblox lança chat entre amigos', 'Chat do Roblox\nentre amigos', ctx)).toMatchObject({ ok: false });
    expect(acceptTitle('Roblox lança chat entre amigos', 'Chat Roblox', { ...ctx, titleMin: 20 })).toMatchObject({ ok: false });
    const long = 'Chat entre amigos do Roblox ' + 'muito '.repeat(30);
    expect(acceptTitle('Roblox lança chat entre amigos', long, { ...ctx, titleMax: 120 })).toMatchObject({ ok: false });
  });

  it('passa pela guarda de estilo: travessão e data decorativa saem do título proposto', () => {
    const r = acceptTitle('Roblox lança chat entre amigos', 'Chat entre amigos do Roblox (20/09/2026): tudo o que muda', ctx);
    expect(r).toMatchObject({ ok: true });
    expect((r as { title: string }).title).not.toMatch(/2026|[—–]/);
    const dashed = acceptTitle('Roblox lança chat entre amigos', 'Chat entre amigos do Roblox — como ativar', ctx);
    expect((dashed as { title: string }).title).not.toMatch(/[—–]/);
  });

  it('aspas em volta do título são retiradas', () => {
    expect(acceptTitle('Roblox lança chat entre amigos', '"Como ativar o chat entre amigos do Roblox"', ctx)).toEqual({
      ok: true,
      title: 'Como ativar o chat entre amigos do Roblox',
    });
  });
});

describe('reviewArticle e o título', () => {
  it('o revisor troca o título para casar com o texto revisado, e o motivo fica registrado', async () => {
    const r = await reviewArticle(
      input(),
      {
        llm: llm(reply({ revisedTitle: 'Como ativar o chat entre amigos do Roblox e limitar os filhos', titleReason: 'o texto agora foca em ativar e no controle dos pais' })),
        log: () => {},
      },
    );
    expect(r.status).toBe('revised');
    expect(r.title).toBe('Como ativar o chat entre amigos do Roblox e limitar os filhos');
    expect(r.titleChange).toEqual({
      from: 'Roblox lança chat entre amigos',
      to: 'Como ativar o chat entre amigos do Roblox e limitar os filhos',
      reason: 'o texto agora foca em ativar e no controle dos pais',
    });
  });

  it('título que já casa volta igual: nenhuma mudança registrada', async () => {
    const r = await reviewArticle(input(), { llm: llm(reply()), log: () => {} });
    expect(r.status).toBe('revised');
    expect(r.title).toBe('Roblox lança chat entre amigos');
    expect(r.titleChange).toBeNull();
  });

  it('só o título mudou, com o texto igual: conta como revisão, não como "sem ajustes"', async () => {
    const r = await reviewArticle(
      input(),
      { llm: llm(reply({ revisedHtml: ORIGINAL, revisedTitle: 'Como ativar o chat entre amigos do Roblox', titleReason: 'mais direto' })), log: () => {} },
    );
    expect(r.status).toBe('revised');
    expect(r.html).toBe(ORIGINAL);
    expect(r.title).toBe('Como ativar o chat entre amigos do Roblox');
  });

  it('título com número inventado é descartado, mas a revisão do texto segue', async () => {
    const logs: string[] = [];
    const r = await reviewArticle(
      input(),
      { llm: llm(reply({ revisedTitle: '99 recursos do chat entre amigos do Roblox' })), log: (m) => logs.push(m) },
    );
    expect(r.status).toBe('revised');
    expect(r.html).toBe(GOOD_REVISION);
    expect(r.title).toBe('Roblox lança chat entre amigos');
    expect(r.titleChange).toBeNull();
    expect(logs.join(' ')).toMatch(/título proposto descartado/);
  });

  it('revisão do texto descartada: o título proposto para o texto revisado também não vale', async () => {
    const dangerous = GOOD_REVISION.replace('150 milhões', '999 milhões');
    const r = await reviewArticle(
      input(),
      { llm: llm(reply({ revisedHtml: dangerous, revisedTitle: 'Como ativar o chat entre amigos do Roblox' })), log: () => {} },
    );
    expect(r.status).toBe('rejected');
    expect(r.html).toBe(ORIGINAL);
    expect(r.title).toBe('Roblox lança chat entre amigos');
    expect(r.titleChange).toBeNull();
  });

  it('resposta sem revisedTitle (modelo antigo ou ignorou o campo): o título fica', async () => {
    const { revisedTitle: _a, titleReason: _b, ...legacy } = reply();
    const r = await reviewArticle(input(), { llm: llm(legacy), log: () => {} });
    expect(r.status).toBe('revised');
    expect(r.title).toBe('Roblox lança chat entre amigos');
  });

  it('falha do revisor devolve o título de entrada', async () => {
    const { LlmError } = await import('../src/llm/client');
    const failing: LlmProvider = {
      provider: 'openai',
      model: 'gpt-x',
      async complete() {
        throw new LlmError('HTTP 500');
      },
    };
    const r = await reviewArticle(input(), { llm: failing, log: () => {} });
    expect(r.status).toBe('failed');
    expect(r.title).toBe('Roblox lança chat entre amigos');
    expect(r.titleChange).toBeNull();
  });

  it('o prompt pede a checagem do título com os limites do template, e o schema exige o campo', async () => {
    const model = llm(reply());
    await reviewArticle(input({ titleMin: 15, titleMax: 90 }), { llm: model, log: () => {} });
    const req = model.calls[0]!;
    expect(req.prompt).toMatch(/5\. TÍTULO/);
    expect(req.prompt).toMatch(/entre 15 e 90 caracteres/);
    expect(req.prompt).toMatch(/revisedTitle/);
    const schema = req.schema as { required: string[] };
    expect(schema.required).toEqual(expect.arrayContaining(['revisedTitle', 'titleReason']));
  });

  it('em inglês o prompt também pede o título', async () => {
    const model = llm(reply());
    await reviewArticle(input({ language: 'en-US' }), { llm: model, log: () => {} });
    expect(model.calls[0]!.prompt).toMatch(/5\. TITLE/);
  });
});
