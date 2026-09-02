import { describe, expect, it } from 'vitest';
import { buildTrimmedContext, prePassCheck } from '../src/pipeline/pre-pass';

const PATTERN = '^[A-Za-z0-9!?_@#.\\-]{2,40}$';

function ctx(text: string) {
  return `FONTE 1 [en-current]\n[Guia de códigos](https://ex.com/codes)\n\n${text}`;
}

describe('prePassCheck', () => {
  it('sem mudanças quando todos os publicados aparecem e não há tokens novos', () => {
    const r = prePassCheck({
      searchContext: ctx('active codes: FRUIT20 and SUB2NOOB still working this month'),
      lastValues: ['FRUIT20', 'SUB2NOOB'],
      lastActiveValues: ['FRUIT20', 'SUB2NOOB'],
      valuePattern: PATTERN,
    });
    expect(r.changed).toBe(false);
    expect(r.missing).toEqual([]);
    expect(r.newCandidates).toEqual([]);
  });

  it('detecta código publicado que sumiu das fontes (provável expiração)', () => {
    const r = prePassCheck({
      searchContext: ctx('codes: FRUIT20 works fine'),
      lastValues: ['FRUIT20', 'OLDCODE99'],
      lastActiveValues: ['FRUIT20', 'OLDCODE99'],
      valuePattern: PATTERN,
    });
    expect(r.changed).toBe(true);
    expect(r.missing).toEqual(['OLDCODE99']);
  });

  it('detecta código novo perto de keyword', () => {
    const r = prePassCheck({
      searchContext: ctx('new codes released today: MEGA2XP5 gives double xp'),
      lastValues: ['FRUIT20'],
      lastActiveValues: ['FRUIT20'],
      valuePattern: PATTERN,
    });
    expect(r.changed).toBe(true);
    expect(r.newCandidates).toContain('MEGA2XP5');
  });

  it('a checagem de sumidos ignora espaços/caixa (normalização)', () => {
    const r = prePassCheck({
      searchContext: ctx('codes list: f r u i t 2 0 spaced out'),
      lastValues: ['FRUIT20'],
      lastActiveValues: ['FRUIT20'],
      valuePattern: PATTERN,
    });
    expect(r.missing).toEqual([]);
  });

  it('ignora domínios, anos e palavras comuns como candidatos', () => {
    const r = prePassCheck({
      searchContext: ctx('codes updated 2026 by progameguides.com and beebom.com — see the codes page'),
      lastValues: ['FRUIT20'],
      lastActiveValues: [],
      valuePattern: PATTERN,
    });
    expect(r.newCandidates).toEqual([]);
    expect(r.changed).toBe(false);
  });

  it('token longe de keywords não vira candidato', () => {
    const r = prePassCheck({
      searchContext: ctx('intro do artigo... ' + 'x'.repeat(2000) + ' TOKEN9XYZ aparece longe de qualquer palavra-chave'),
      lastValues: ['FRUIT20'],
      lastActiveValues: [],
      valuePattern: PATTERN,
      keywordWindowChars: 100,
    });
    expect(r.newCandidates).toEqual([]);
  });

  /**
   * Regressão: a janela ao redor da keyword já foi uma fatia do texto
   * (`slice`), que cortava um código ao meio quando a borda caía no seu miolo.
   * O fragmento parecia código (tem dígito) e não batia com a lista publicada,
   * virando falso positivo que disparava uma chamada de IA no modo econômico.
   */
  it('borda da janela no meio de um código não gera candidato fragmentado', () => {
    // "codes" no índice 8; com janela de 5 a fatia começaria no índice 3,
    // dentro de "FRUIT20", produzindo o fragmento "IT20"
    const r = prePassCheck({
      searchContext: 'FRUIT20 codes',
      lastValues: ['FRUIT20'],
      lastActiveValues: ['FRUIT20'],
      valuePattern: PATTERN,
      keywordWindowChars: 5,
    });
    expect(r.newCandidates).toEqual([]);
    expect(r.changed).toBe(false);
  });

  it('mesmo com o código longe do início, o corte não fragmenta', () => {
    // "ALUCINADO1" em [201,211) e "codes" em 212; janela de 6 cortaria em 206,
    // produzindo o fragmento "NADO1"
    const filler = 'x'.repeat(200);
    const r = prePassCheck({
      searchContext: `${filler} ALUCINADO1 codes ${filler}`,
      lastValues: ['ALUCINADO1'],
      lastActiveValues: ['ALUCINADO1'],
      valuePattern: PATTERN,
      keywordWindowChars: 6,
    });
    expect(r.newCandidates).toEqual([]);
    expect(r.changed).toBe(false);
  });
});

describe('buildTrimmedContext', () => {
  it('mantém cabeçalhos das fontes e janelas ao redor dos tokens', () => {
    const filler = 'lorem ipsum '.repeat(500);
    const full = `FONTE 1 [en-current]\n[Guia](https://ex.com)\n\n${filler}the code NEW5CODE gives rewards${filler}`;
    const out = buildTrimmedContext(full, ['NEW5CODE'], { windowChars: 100, maxChars: 5000 });
    expect(out).toContain('FONTE 1 [en-current]');
    expect(out).toContain('NEW5CODE');
    expect(out.length).toBeLessThan(full.length / 2);
  });

  it('mescla janelas sobrepostas e respeita o teto', () => {
    const full = 'a'.repeat(100) + ' CODE1A CODE2B ' + 'b'.repeat(100);
    const out = buildTrimmedContext(full, ['CODE1A', 'CODE2B'], { windowChars: 50, maxChars: 400 });
    expect((out.match(/CODE1A/g) ?? []).length).toBe(1);
    expect(out.length).toBeLessThanOrEqual(400);
  });
});
