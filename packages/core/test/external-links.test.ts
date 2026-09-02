import { describe, expect, it } from 'vitest';
import { sanitizeExternalLinks } from '../src/html/external-links';

const SOURCES = [
  'https://progameguides.com/blox-fruits-codes',
  'https://www.tryhardguides.com/anime-vanguards/', // www + trailing slash
];

describe('sanitizeExternalLinks', () => {
  it('mantém link externo presente nas fontes', () => {
    const html = '<p>Veja mais em <a href="https://progameguides.com/blox-fruits-codes">ProGameGuides</a>.</p>';
    const res = sanitizeExternalLinks(html, SOURCES);
    expect(res.kept).toBe(1);
    expect(res.stripped).toHaveLength(0);
    expect(res.html).toContain('<a href=');
  });

  it('normaliza www/trailing slash ao comparar', () => {
    const html = '<p><a href="https://tryhardguides.com/anime-vanguards">guia</a></p>';
    const res = sanitizeExternalLinks(html, SOURCES);
    expect(res.kept).toBe(1);
    expect(res.stripped).toHaveLength(0);
  });

  it('remove link externo alucinado, preservando o texto', () => {
    const html = '<p>Fonte: <a href="https://fake-invented-site.com/x">inventado</a> aqui.</p>';
    const res = sanitizeExternalLinks(html, SOURCES);
    expect(res.kept).toBe(0);
    expect(res.stripped).toEqual(['https://fake-invented-site.com/x']);
    expect(res.html).toBe('<p>Fonte: inventado aqui.</p>');
  });

  it('não mexe em links internos/relativos/âncora', () => {
    const html = '<p><a href="/pagina">interna</a> <a href="#secao">âncora</a></p>';
    const res = sanitizeExternalLinks(html, SOURCES);
    expect(res.kept).toBe(0);
    expect(res.stripped).toHaveLength(0);
    expect(res.html).toBe(html);
  });

  it('trata links do próprio site como internos (siteBaseUrl)', () => {
    const html = '<p><a href="https://deepgames.com.br/outro-post">post interno</a></p>';
    const res = sanitizeExternalLinks(html, SOURCES, { siteBaseUrl: 'https://deepgames.com.br' });
    expect(res.kept).toBe(1);
    expect(res.stripped).toHaveLength(0);
    expect(res.html).toContain('<a href=');
  });

  it('lida com múltiplos links misturados', () => {
    const html =
      '<p><a href="https://progameguides.com/blox-fruits-codes">ok</a> e ' +
      '<a href="https://spam.com/x">ruim</a> e <a href="/interno">int</a></p>';
    const res = sanitizeExternalLinks(html, SOURCES);
    expect(res.kept).toBe(1);
    expect(res.stripped).toEqual(['https://spam.com/x']);
    expect(res.html).toContain('ruim');
    expect(res.html).not.toContain('spam.com');
  });
});
