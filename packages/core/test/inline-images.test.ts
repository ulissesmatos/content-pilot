import { describe, expect, it } from 'vitest';
import { injectInlineImages, suggestedInlineCount, type InlineImage } from '../src/html/inline-images';

const p = (text: string) => `<!-- wp:paragraph -->\n<p>${text}</p>\n<!-- /wp:paragraph -->`;

const img = (n: number): InlineImage => ({
  url: `https://wp.example/media/${n}.jpg`,
  alt: `Imagem ${n}`,
  caption: n === 1 ? 'Crédito & autor' : undefined,
});

describe('suggestedInlineCount', () => {
  it('0 quando max=0 ou texto curto', () => {
    expect(suggestedInlineCount(p('a'.repeat(5000)), 0)).toBe(0);
    expect(suggestedInlineCount(p('texto curto'), 3)).toBe(0);
  });

  it('escala com o tamanho do texto e respeita o teto', () => {
    expect(suggestedInlineCount(p('a'.repeat(1500)), 3)).toBe(1);
    expect(suggestedInlineCount(p('a'.repeat(4500)), 3)).toBe(2);
    expect(suggestedInlineCount(p('a'.repeat(30000)), 3)).toBe(3);
  });

  it('ignora tags e comentários na contagem', () => {
    const html = `<!-- wp:paragraph --><p>${'a'.repeat(100)}</p><!-- /wp:paragraph -->`;
    expect(suggestedInlineCount(html, 3)).toBe(0);
  });
});

describe('injectInlineImages', () => {
  it('insere blocos Gutenberg distribuídos entre os parágrafos', () => {
    const html = [p('um'), p('dois'), p('três'), p('quatro'), p('cinco'), p('seis')].join('\n');
    const out = injectInlineImages(html, [img(1), img(2)]);
    expect(out.match(/<!-- wp:image/g)).toHaveLength(2);
    // nunca antes do primeiro parágrafo
    expect(out.indexOf('<!-- wp:image')).toBeGreaterThan(out.indexOf('<p>um</p>'));
    // ordem preservada: imagem 1 antes da 2
    expect(out.indexOf('media/1.jpg')).toBeLessThan(out.indexOf('media/2.jpg'));
    // alt e caption escapados/presentes
    expect(out).toContain('alt="Imagem 1"');
    expect(out).toContain('Crédito &amp; autor');
    // imagem sem caption não gera figcaption
    const secondBlock = out.slice(out.indexOf('media/2.jpg'));
    expect(secondBlock.slice(0, 200)).not.toContain('figcaption');
  });

  it('cai no </p> plano quando não há comentários Gutenberg', () => {
    const html = '<p>um</p><p>dois</p><p>três</p>';
    const out = injectInlineImages(html, [img(1)]);
    expect(out).toContain('<!-- wp:image');
    expect(out.indexOf('<!-- wp:image')).toBeGreaterThan(out.indexOf('<p>um</p>'));
  });

  it('não insere dentro de bloco gerenciado', () => {
    const widget = `<!-- CP-BLOCK:START --><p>w1</p><p>w2</p><p>w3</p><!-- CP-BLOCK:END -->`;
    const html = `<p>fora</p>${widget}`;
    const out = injectInlineImages(html, [img(1)]);
    // único ponto válido é o </p> de "fora"
    const blockPos = out.indexOf('<!-- wp:image');
    expect(blockPos).toBeGreaterThan(-1);
    expect(blockPos).toBeLessThan(out.indexOf('CP-BLOCK:START'));
  });

  it('fail-safe: sem parágrafos ou sem imagens devolve o HTML intacto', () => {
    expect(injectInlineImages('<div>nada</div>', [img(1)])).toBe('<div>nada</div>');
    expect(injectInlineImages('<p>um</p>', [])).toBe('<p>um</p>');
  });

  it('mais imagens que parágrafos: insere no máximo uma por parágrafo', () => {
    const html = [p('um'), p('dois')].join('\n');
    const out = injectInlineImages(html, [img(1), img(2), img(3)]);
    expect(out.match(/<!-- wp:image/g)).toHaveLength(2);
  });
});
