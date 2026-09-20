import { describe, expect, it } from 'vitest';
import {
  applyStyleGuard,
  buildStyleInstructions,
  rewriteDashesInHtml,
  rewriteDashesInText,
  stripDecorativeDates,
} from '../src/text/style-guard';

const NO_DASH = /[—–―]/;

describe('rewriteDashesInText', () => {
  it('aposto com dois travessões vira vírgulas', () => {
    const r = rewriteDashesInText('O jogo — lançado em 2020 — recebeu uma atualização.');
    expect(r.text).toBe('O jogo, lançado em 2020, recebeu uma atualização.');
    expect(r.count).toBe(2);
  });

  it('rótulo curto seguido de explicação vira dois-pontos', () => {
    expect(rewriteDashesInText('Resultado — três códigos novos estão ativos hoje.').text).toBe(
      'Resultado: três códigos novos estão ativos hoje.',
    );
  });

  it('travessão isolado depois de trecho longo vira vírgula, não dois-pontos', () => {
    const r = rewriteDashesInText('A empresa confirmou que o recurso chega em breve — e ninguém esperava isso.');
    expect(r.text).toBe('A empresa confirmou que o recurso chega em breve, e ninguém esperava isso.');
  });

  it('não duplica pontuação que já existia', () => {
    expect(rewriteDashesInText('Chegou, — finalmente — a novidade.').text).not.toMatch(/,\s*,/);
  });

  it('travessão no começo (fala) ou no fim da frase some', () => {
    expect(rewriteDashesInText('— Olá, pessoal.').text).toBe('Olá, pessoal.');
    expect(rewriteDashesInText('Fim de papo —').text).toBe('Fim de papo');
  });

  it('en dash espaçado recebe o mesmo tratamento do em dash', () => {
    expect(rewriteDashesInText('Foi rápido – e barato para todo mundo.').text).toBe(
      'Foi rápido, e barato para todo mundo.',
    );
  });

  it('faixa numérica e composto sem espaço viram hífen', () => {
    expect(rewriteDashesInText('Entre 2020–2023 houve 10–15 lançamentos.').text).toBe(
      'Entre 2020-2023 houve 10-15 lançamentos.',
    );
    expect(rewriteDashesInText('Versão Xbox–PC disponível.').text).toBe('Versão Xbox-PC disponível.');
  });

  it('hífen ASCII espaçado entre letras é o mesmo tique e também é reescrito', () => {
    const r = rewriteDashesInText('O Roblox - agora com chat de amigos - chegou ao Brasil.');
    expect(r.text).toBe('O Roblox, agora com chat de amigos, chegou ao Brasil.');
  });

  it('hífen que não é pontuação fica intacto', () => {
    const t = 'O Homem-Aranha e o guarda-chuva custam 10 - 20 reais.';
    expect(rewriteDashesInText(t).text).toBe(t);
  });

  it('entidades HTML de travessão também são pegas', () => {
    expect(rewriteDashesInText('Novo &mdash; e melhor para todos os jogadores.').text).not.toMatch(NO_DASH);
    expect(rewriteDashesInText('Novo &#8212; e melhor para todos os jogadores.').text).not.toMatch(/&#8212;/);
  });

  it('nenhum travessão sobra, nunca, seja qual for a combinação', () => {
    const samples = [
      'A — B — C — D',
      '— — —',
      'texto—colado—sem espaço',
      'Início. — Ele disse. — Fim.',
      '2020–2023 – e — mais',
      'Fim —.',
    ];
    for (const s of samples) expect(rewriteDashesInText(s).text).not.toMatch(NO_DASH);
  });

  it('texto sem travessão volta idêntico e com contagem zero', () => {
    const t = 'Um parágrafo comum, com vírgulas: e ponto final.';
    expect(rewriteDashesInText(t)).toEqual({ text: t, count: 0 });
  });

  it('modo título usa dois-pontos no primeiro travessão', () => {
    expect(rewriteDashesInText('Roblox — o que muda no chat entre amigos', { title: true }).text).toBe(
      'Roblox: o que muda no chat entre amigos',
    );
  });
});

describe('rewriteDashesInHtml', () => {
  it('só mexe em nós de texto e preserva a estrutura Gutenberg', () => {
    const html =
      '<!-- wp:paragraph -->\n<p>Chegou — finalmente — o recurso.</p>\n<!-- /wp:paragraph -->';
    const r = rewriteDashesInHtml(html);
    expect(r.text).toBe('<!-- wp:paragraph -->\n<p>Chegou, finalmente, o recurso.</p>\n<!-- /wp:paragraph -->');
    expect(r.count).toBe(2);
  });

  it('não toca em atributos, URLs nem no JSON dos comentários de bloco', () => {
    const html =
      '<!-- wp:image {"alt":"foto — capa"} -->\n<p><a href="https://x.com/a–b" title="um — dois">link</a></p>';
    const r = rewriteDashesInHtml(html);
    expect(r.text).toBe(html);
    expect(r.count).toBe(0);
  });

  it('não toca em code, pre, script e style', () => {
    const html = '<pre>a — b</pre><p>c — d e f g</p><code>x — y</code>';
    const r = rewriteDashesInHtml(html);
    expect(r.text).toContain('<pre>a — b</pre>');
    expect(r.text).toContain('<code>x — y</code>');
    expect(r.text).toContain('<p>c: d e f g</p>');
  });

  it('funciona com texto quebrado por tags inline', () => {
    const r = rewriteDashesInHtml('<p>Veja <strong>isso</strong> — é importante mesmo.</p>');
    expect(r.text).not.toMatch(NO_DASH);
    expect(r.text).toContain('<strong>isso</strong>');
  });

  it('HTML vazio volta como está', () => {
    expect(rewriteDashesInHtml('')).toEqual({ text: '', count: 0 });
  });
});

describe('stripDecorativeDates', () => {
  it('o caso real do log: data entre parênteses no meio do título', () => {
    const r = stripDecorativeDates(
      'Como funciona a nova aba de chat entre amigos do Roblox (20/09/2026): recursos, onde ativar e como testar',
    );
    expect(r.removed).toBe(true);
    expect(r.title).toBe('Como funciona a nova aba de chat entre amigos do Roblox: recursos, onde ativar e como testar');
  });

  it('data depois de separador no fim', () => {
    expect(stripDecorativeDates('Novidades do Fortnite - setembro de 2026').title).toBe('Novidades do Fortnite');
    expect(stripDecorativeDates('Guia completo de Minecraft | 20/09/2026').title).toBe('Guia completo de Minecraft');
  });

  it('data preposicionada no fim', () => {
    expect(stripDecorativeDates('Melhores builds do Diablo em setembro de 2026').title).toBe(
      'Melhores builds do Diablo',
    );
  });

  it('ano entre parênteses sai, ano que faz parte do assunto fica', () => {
    expect(stripDecorativeDates('Review do novo Zelda (2026)').title).toBe('Review do novo Zelda');
    const keep = 'Os 10 melhores jogos de 2026 para PC';
    expect(stripDecorativeDates(keep)).toEqual({ title: keep, removed: false });
  });

  it('nunca mutila: se sobrar título curto demais, devolve o original', () => {
    const t = 'Zelda (20/09/2026)';
    expect(stripDecorativeDates(t, { minLength: 10 })).toEqual({ title: t, removed: false });
  });

  it('título sem data fica intacto', () => {
    const t = 'Como funciona o novo sistema de amigos';
    expect(stripDecorativeDates(t)).toEqual({ title: t, removed: false });
  });

  it('limpa a pontuação que a remoção deixaria órfã', () => {
    const r = stripDecorativeDates('Guia do jogo (20/09/2026): dicas, truques e mais');
    expect(r.title).toBe('Guia do jogo: dicas, truques e mais');
    expect(r.title).not.toMatch(/\s{2,}|:\s*:|\(\)/);
  });
});

describe('applyStyleGuard', () => {
  const input = {
    title: 'Roblox — chat entre amigos (20/09/2026)',
    html: '<!-- wp:paragraph --><p>Chegou — finalmente — o recurso.</p><!-- /wp:paragraph -->',
    metaDescription: 'Veja tudo — e como ativar o novo chat no Roblox.',
  };

  it('aplica tudo quando a política pede', () => {
    const r = applyStyleGuard(input, { noDashes: true, datePolicy: 'avoid' });
    expect(r.title).toBe('Roblox: chat entre amigos');
    expect(r.html).toContain('Chegou, finalmente, o recurso.');
    expect(r.metaDescription).not.toMatch(NO_DASH);
    expect(r.titleDateRemoved).toBe(true);
    expect(r.dashesRewritten).toBeGreaterThan(0);
  });

  it('datePolicy allow preserva a data do título (templates de códigos)', () => {
    const r = applyStyleGuard(
      { ...input, title: 'Códigos Blox Fruits setembro de 2026' },
      { noDashes: true, datePolicy: 'allow' },
    );
    expect(r.title).toBe('Códigos Blox Fruits setembro de 2026');
    expect(r.titleDateRemoved).toBe(false);
  });

  it('noDashes desligado não mexe no texto', () => {
    const r = applyStyleGuard(input, { noDashes: false, datePolicy: 'allow' });
    expect(r.html).toBe(input.html);
    expect(r.dashesRewritten).toBe(0);
  });

  it('é idempotente: rodar duas vezes não muda mais nada', () => {
    const once = applyStyleGuard(input, { noDashes: true, datePolicy: 'avoid' });
    const twice = applyStyleGuard(
      { title: once.title, html: once.html, metaDescription: once.metaDescription },
      { noDashes: true, datePolicy: 'avoid' },
    );
    expect(twice.title).toBe(once.title);
    expect(twice.html).toBe(once.html);
    expect(twice.dashesRewritten).toBe(0);
  });
});

describe('buildStyleInstructions', () => {
  it('só inclui as regras que a política liga', () => {
    const both = buildStyleInstructions({ noDashes: true, datePolicy: 'avoid' }, 'pt-BR');
    expect(both).toMatch(/travess/i);
    expect(both).toMatch(/data/i);
    expect(buildStyleInstructions({ noDashes: true, datePolicy: 'allow' }, 'pt-BR')).not.toMatch(/data, dia/i);
    expect(buildStyleInstructions({ noDashes: false, datePolicy: 'allow' }, 'pt-BR')).toBe('');
  });

  it('respeita o idioma e declara prioridade sobre o prompt do template', () => {
    expect(buildStyleInstructions({ noDashes: true, datePolicy: 'avoid' }, 'en-US')).toMatch(/em dashes/i);
    expect(buildStyleInstructions({ noDashes: true, datePolicy: 'avoid' }, 'pt-BR')).toMatch(/prioridade/i);
  });
});
