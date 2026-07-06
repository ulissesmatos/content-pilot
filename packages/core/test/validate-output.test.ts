import { describe, expect, it } from 'vitest';
import { validateOutput } from '../src/pipeline/validate-output';
import { gameCodesTemplate } from '../src/templates/seeds/game-codes';
import { parseTemplateConfig } from '../src/templates/schema';

const cfg = parseTemplateConfig(gameCodesTemplate.config);

const GOOD_HTML =
  '<!-- wp:paragraph --><p>Post sobre códigos do jogo com conteúdo suficiente para passar do mínimo de caracteres exigido pela validação. Texto adicional para garantir tamanho, incluindo instruções de resgate e contexto do jogo.</p><!-- /wp:paragraph -->';

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    hasChanges: true,
    noDataFound: false,
    newTitle: 'Códigos do Jogo (julho de 2026): lista completa',
    updatedHtml: GOOD_HTML,
    data: {
      activeCodes: [{ code: 'ABC123', reward: '100 gems', isNew: true, source: 'https://ex.com' }],
      expiredCodes: [],
    },
    searchContext: 'FONTE 1\ncódigos ativos: ABC123 e XYZ789 valem prêmios',
    resultsCount: 5,
    ...overrides,
  };
}

describe('validateOutput — matriz fail-safe', () => {
  it('caso feliz passa e mantém os códigos', () => {
    const r = validateOutput(baseInput(), cfg);
    expect(r.ok).toBe(true);
    expect((r.data.activeCodes as unknown[]).length).toBe(1);
    expect(r.dropped).toEqual([]);
  });

  it('dropa código alucinado (não aparece nas fontes)', () => {
    const r = validateOutput(
      baseInput({
        data: {
          activeCodes: [
            { code: 'ABC123', reward: null, isNew: false, source: 's' },
            { code: 'INVENTADO99', reward: null, isNew: false, source: 's' },
          ],
          expiredCodes: [],
        },
      }),
      cfg,
    );
    expect(r.ok).toBe(true); // sobrou 1 válido
    expect((r.data.activeCodes as unknown[]).length).toBe(1);
    expect(r.dropped[0]).toMatchObject({ value: 'INVENTADO99', reason: expect.stringContaining('alucinação') });
  });

  it('checagem verbatim ignora espaços e caixa (normalização)', () => {
    const r = validateOutput(
      baseInput({
        data: { activeCodes: [{ code: 'XYZ789', reward: null, isNew: false, source: 's' }], expiredCodes: [] },
        searchContext: 'os códigos:\n  x Y z 7 8 9  \nfim', // quebrado por formatação
      }),
      cfg,
    );
    expect((r.data.activeCodes as unknown[]).length).toBe(1);
  });

  it('dropa duplicados entre listas e formatos inválidos', () => {
    const r = validateOutput(
      baseInput({
        data: {
          activeCodes: [
            { code: 'ABC123', reward: null, isNew: false, source: 's' },
            { code: 'abc123', reward: null, isNew: false, source: 's' },
            { code: 'tem espaço', reward: null, isNew: false, source: 's' },
          ],
          expiredCodes: [],
        },
      }),
      cfg,
    );
    expect((r.data.activeCodes as unknown[]).length).toBe(1);
    expect(r.dropped.map((d) => d.reason)).toEqual(['duplicado', 'formato inválido']);
  });

  it('reprova quando todos os candidatos caem (não publica)', () => {
    const r = validateOutput(
      baseInput({
        data: { activeCodes: [{ code: 'INVENTADO', reward: null, isNew: false, source: 's' }], expiredCodes: [] },
      }),
      cfg,
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join(';')).toContain('todos os itens candidatos foram reprovados');
  });

  it('reprova noDataFound com poucas fontes (evidência fraca)', () => {
    const r = validateOutput(
      baseInput({ noDataFound: true, data: { activeCodes: [], expiredCodes: [] }, resultsCount: 2 }),
      cfg,
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join(';')).toContain('evidência fraca');
  });

  it('reprova zero fontes com extração habilitada', () => {
    const r = validateOutput(baseInput({ resultsCount: 0 }), cfg);
    expect(r.ok).toBe(false);
    expect(r.errors.join(';')).toContain('sem base para atualizar');
  });

  it('reprova HTML com script, blocos desbalanceados, markdown fence e widget embutido', () => {
    const checks: Array<[string, string]> = [
      [GOOD_HTML + '<script>alert(1)</script>', '<script>/<style>'],
      [GOOD_HTML + '<!-- wp:list -->', 'desbalanceados'],
      [GOOD_HTML + '```js', 'cerca de código'],
      [GOOD_HTML + '<div class="dg-codes-widget"></div>', 'bloco gerenciado'],
    ];
    for (const [html, expected] of checks) {
      const r = validateOutput(baseInput({ updatedHtml: html }), cfg);
      expect(r.ok).toBe(false);
      expect(r.errors.join(';')).toContain(expected);
    }
  });

  it('reprova títulos inválidos', () => {
    for (const title of ['curto', 'T'.repeat(130), 'Título com <b>html</b> proibido no meio']) {
      const r = validateOutput(baseInput({ newTitle: title }), cfg);
      expect(r.ok).toBe(false);
    }
  });
});
