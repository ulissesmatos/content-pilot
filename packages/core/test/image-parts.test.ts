import { describe, expect, it } from 'vitest';
import { buildSlotQuery, keyTerms, planImageSlots } from '../src/images/slots';
import { fetchSourceImages, parsePageImage } from '../src/images/source-images';
import { pickApiSize } from '../src/images/generate';
import {
  gutenbergImageBlock,
  injectAfterParagraphs,
  paragraphEnds,
  planInlineInsertions,
} from '../src/html/inline-images';

const P = (t: string) => `<!-- wp:paragraph --><p>${t}</p><!-- /wp:paragraph -->`;
const H = (t: string) => `<!-- wp:heading {"level":3} --><h3>${t}</h3><!-- /wp:heading -->`;
const HTML = [
  P('Introdução sobre o jogo.'),
  H('Mapa e cidades'),
  P('Vice City volta com bairros novos.'),
  P('A cidade muda com o horário.'),
  H('Personagens'),
  P('Lucia e Jason são os protagonistas.'),
  P('A dupla planeja assaltos.'),
  P('Fim da história.'),
].join('');
const SIZE = { width: 1280, height: 720 };

describe('planInlineInsertions', () => {
  it('devolve o contexto de cada ponto: parágrafo e título da seção', () => {
    const plan = planInlineInsertions(HTML, 2);
    expect(plan).toHaveLength(2);
    for (const point of plan) {
      expect(point.paragraphText.length).toBeGreaterThan(0);
      expect(point.paragraphText).not.toMatch(/<|wp:/);
    }
    // o segundo ponto cai depois de "Personagens", então esse é o título dele
    expect(plan.at(-1)!.heading).toBe('Personagens');
  });

  it('nunca escolhe o mesmo ponto duas vezes nem passa do número de parágrafos', () => {
    const plan = planInlineInsertions(P('um') + P('dois'), 6);
    expect(plan.length).toBeLessThanOrEqual(2);
    expect(new Set(plan.map((p) => p.pos)).size).toBe(plan.length);
  });

  it('sem parágrafos ou sem pedido, plano vazio', () => {
    expect(planInlineInsertions('', 2)).toEqual([]);
    expect(planInlineInsertions(HTML, 0)).toEqual([]);
    expect(planInlineInsertions('<div>sem parágrafo</div>', 2)).toEqual([]);
  });
});

describe('planInlineInsertions: preferência pelas seções que o editor indicou', () => {
  it('a dica "uma imagem ajuda em Segurança" vira um ponto NAQUELA seção', () => {
    // sem dica, 2 imagens em 6 parágrafos caem nos parágrafos 1 e 3, e Segurança fica sem nenhuma
    const plain = planInlineInsertions(HTML, 2);
    expect(plain.some((p) => p.heading === 'Personagens')).toBe(true);

    const hinted = planInlineInsertions(HTML, 2, { preferHeadings: ['Personagens'] });
    expect(hinted).toHaveLength(2);
    // o primeiro parágrafo depois do título é o ponto preferido
    const personagens = hinted.find((p) => p.heading === 'Personagens');
    expect(personagens?.paragraphText).toBe('Lucia e Jason são os protagonistas.');
  });

  it('ignora caixa e acento ao casar o título', () => {
    const plan = planInlineInsertions(HTML, 1, { preferHeadings: ['PERSONAGENS'] });
    expect(plan[0]!.heading).toBe('Personagens');
    const acento = planInlineInsertions(
      P('a') + H('Segurança') + P('texto de segurança') + P('outro texto'),
      1,
      { preferHeadings: ['SEGURANCA'] },
    );
    expect(acento[0]!.heading).toBe('Segurança');
  });

  it('título que não existe no HTML não quebra: cai na distribuição uniforme', () => {
    const plan = planInlineInsertions(HTML, 2, { preferHeadings: ['Título inexistente'] });
    expect(plan).toHaveLength(2);
  });

  it('nunca passa do total pedido, mesmo com mais dicas que imagens', () => {
    const plan = planInlineInsertions(HTML, 1, { preferHeadings: ['Mapa e cidades', 'Personagens'] });
    expect(plan).toHaveLength(1);
  });

  it('a ordem do plano segue a ordem do documento, e os pontos são distintos', () => {
    const plan = planInlineInsertions(HTML, 3, { preferHeadings: ['Personagens'] });
    const idx = plan.map((p) => p.paragraphIndex);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    expect(new Set(idx).size).toBe(idx.length);
  });

  it('os pontos preferidos entram no total sem duplicar com os uniformes', () => {
    for (let n = 1; n <= 5; n++) {
      const plan = planInlineInsertions(HTML, n, { preferHeadings: ['Mapa e cidades', 'Personagens'] });
      expect(new Set(plan.map((p) => p.paragraphIndex)).size).toBe(plan.length);
    }
  });
});

describe('injectAfterParagraphs', () => {
  const img = (n: number) => ({ url: `https://wp/${n}.webp`, alt: `alt ${n}`, mediaId: 100 + n });

  it('cada imagem cai depois do parágrafo do PRÓPRIO slot, mesmo quando outro slot falhou', () => {
    const plan = planInlineInsertions(HTML, 2);
    const onlySecond = injectAfterParagraphs(HTML, [{ afterParagraph: plan[1]!.paragraphIndex, image: img(2) }]);
    const idx = onlySecond.indexOf('https://wp/2.webp');
    expect(idx).toBe(plan[1]!.pos + gutenbergImageBlock(img(2)).indexOf('https://wp/2.webp'));
  });

  it('preserva a estrutura de blocos e não perde texto', () => {
    const out = injectAfterParagraphs(HTML, [
      { afterParagraph: 1, image: img(1) },
      { afterParagraph: 3, image: img(2) },
    ]);
    expect(out.match(/<!-- wp:/g)!.length).toBe(out.match(/<!-- \/wp:/g)!.length);
    for (const t of ['Vice City volta', 'Lucia e Jason', 'Fim da história']) expect(out).toContain(t);
  });

  it('duas imagens em parágrafos diferentes não se atropelam (inserção de trás para frente)', () => {
    const out = injectAfterParagraphs(HTML, [
      { afterParagraph: 1, image: img(1) },
      { afterParagraph: 4, image: img(2) },
    ]);
    expect(out.indexOf('wp/1.webp')).toBeLessThan(out.indexOf('wp/2.webp'));
    expect(out.match(/<!-- wp:image/g)).toHaveLength(2);
  });

  it('a imagem leva o ID da mídia do WP, a identidade que a tela de preview usa para trocá-la', () => {
    const block = gutenbergImageBlock(img(5));
    expect(block).toContain('"id":105');
    expect(block).toContain('class="wp-image-105"');
  });

  it('sem mediaId, o bloco continua válido e sem a classe', () => {
    const block = gutenbergImageBlock({ url: 'https://x/a.jpg', alt: 'a' });
    expect(block).not.toContain('wp-image-');
    expect(block).toContain('wp:image {"sizeSlug":"large","linkDestination":"none"}');
  });

  it('parágrafo inexistente ou índice inválido é ignorado em vez de lançar', () => {
    expect(() => injectAfterParagraphs(HTML, [{ afterParagraph: 99, image: img(1) }])).not.toThrow();
    expect(injectAfterParagraphs(HTML, [{ afterParagraph: 99, image: img(1) }])).toBe(HTML);
    expect(injectAfterParagraphs(HTML, [{ afterParagraph: -1, image: img(1) }])).toBe(HTML);
    expect(injectAfterParagraphs(HTML, [{ afterParagraph: 1.5, image: img(1) }])).toBe(HTML);
  });

  it('paragraphEnds respeita o mesmo filtro do plano (fora de bloco gerenciado)', () => {
    const managed = P('antes') + '<!-- CP-BLOCK:START --><p>dentro</p><!-- CP-BLOCK:END -->' + P('depois');
    expect(paragraphEnds(managed)).toHaveLength(2);
  });
});

describe('planImageSlots', () => {
  const slots = planImageSlots({
    topic: 'GTA 6',
    keywords: ['gta 6 trailer'],
    html: HTML,
    inlineCount: 2,
    coverSize: { width: 1280, height: 720 },
    inlineSize: { width: 700, height: 300 },
  });

  it('a capa vem primeiro e cada imagem do corpo tem tamanho próprio', () => {
    expect(slots[0]).toMatchObject({ id: 'cover', role: 'cover', size: { width: 1280, height: 720 } });
    expect(slots[1]).toMatchObject({ role: 'inline', size: { width: 700, height: 300 } });
  });

  it('o slot do corpo descreve o trecho onde a imagem cai', () => {
    const inline = slots.filter((s) => s.role === 'inline');
    expect(inline).toHaveLength(2);
    expect(inline.map((s) => s.description).join(' ')).toMatch(/Vice City|Lucia|Mapa e cidades|Personagens/);
    expect(inline[1]!.heading).toBe('Personagens');
  });

  it('as consultas diferem entre slots: a seção afina a busca', () => {
    const queries = slots.map((s) => s.query);
    expect(new Set(queries).size).toBe(queries.length);
    // e todas continuam ancoradas no assunto do artigo
    for (const q of queries) expect(q.toLowerCase()).toContain('gta 6');
  });

  it('inlineCount 0: só a capa', () => {
    const only = planImageSlots({
      topic: 'X', keywords: [], html: HTML, inlineCount: 0, coverSize: SIZE, inlineSize: SIZE,
    });
    expect(only.map((s) => s.id)).toEqual(['cover']);
  });
});

describe('keyTerms e buildSlotQuery', () => {
  it('tira stopwords, números soltos e repetições', () => {
    expect(keyTerms('O mapa de Vice City e a cidade de Vice City em 2026')).toEqual(['mapa', 'Vice', 'City', 'cidade']);
  });

  it('sem keywords usa o tópico como âncora', () => {
    expect(buildSlotQuery('Chat entre amigos do Roblox', [], null, '')).toMatch(/chat|amigos|Roblox/i);
  });

  it('respeita o limite de tamanho da consulta', () => {
    expect(buildSlotQuery('a'.repeat(300), ['b'.repeat(300)], 'c'.repeat(300), 'd').length).toBeLessThanOrEqual(140);
  });
});

describe('pickApiSize (tamanho nativo mais próximo)', () => {
  it('paisagem 16:9 e 7:3 pedem o nativo em paisagem', () => {
    expect(pickApiSize('gpt-image-1.5', { width: 1280, height: 720 })).toBe('1536x1024');
    expect(pickApiSize('gpt-image-1', { width: 1920, height: 1080 })).toBe('1536x1024');
    expect(pickApiSize('gpt-image-1', { width: 700, height: 300 })).toBe('1536x1024');
    expect(pickApiSize('dall-e-3', { width: 1280, height: 720 })).toBe('1792x1024');
  });

  it('retrato e quadrado', () => {
    expect(pickApiSize('gpt-image-1', { width: 720, height: 1280 })).toBe('1024x1536');
    expect(pickApiSize('dall-e-3', { width: 720, height: 1280 })).toBe('1024x1792');
    expect(pickApiSize('gpt-image-1', { width: 800, height: 800 })).toBe('1024x1024');
  });

  it('sem tamanho ou tamanho inválido: quadrado, o comportamento de sempre', () => {
    expect(pickApiSize('gpt-image-1')).toBe('1024x1024');
    expect(pickApiSize('gpt-image-1', { width: 0, height: 0 })).toBe('1024x1024');
  });
});

describe('parsePageImage', () => {
  const page = 'https://ign.com/noticias/gta-6';

  it('lê og:image e o título da página', () => {
    const html = `<html><head><title>fallback</title>
      <meta property="og:title" content="GTA 6 ganha trailer &amp; data">
      <meta property="og:image" content="https://cdn.ign.com/gta6.jpg"></head>`;
    expect(parsePageImage(html, page)).toEqual({ imageUrl: 'https://cdn.ign.com/gta6.jpg', title: 'GTA 6 ganha trailer & data' });
  });

  it('resolve URL relativa contra a página', () => {
    const html = '<meta property="og:image" content="/img/capa.jpg">';
    expect(parsePageImage(html, page)?.imageUrl).toBe('https://ign.com/img/capa.jpg');
  });

  it('cai no twitter:image quando não há og:image, e aceita atributos em qualquer ordem e aspas simples', () => {
    expect(parsePageImage("<meta content='https://x.com/t.jpg' name='twitter:image'>", page)?.imageUrl).toBe('https://x.com/t.jpg');
  });

  it('sem imagem, ou com protocolo estranho, devolve null', () => {
    expect(parsePageImage('<title>sem imagem</title>', page)).toBeNull();
    expect(parsePageImage('<meta property="og:image" content="javascript:alert(1)">', page)).toBeNull();
    expect(parsePageImage('<meta property="og:image" content="data:image/png;base64,AAA">', page)).toBeNull();
  });
});

describe('fetchSourceImages', () => {
  const htmlWith = (img: string) => `<html><head><meta property="og:image" content="${img}"></head><body>x</body></html>`;

  const fakeFetch = (routes: Record<string, () => Response | Promise<Response>>): typeof fetch =>
    (async (input: string | URL | Request) => {
      const url = String(input);
      const handler = routes[url];
      if (!handler) throw new Error(`rota inesperada: ${url}`);
      return handler();
    }) as typeof fetch;

  it('devolve a imagem de destaque de cada fonte, com crédito', async () => {
    const out = await fetchSourceImages(['https://www.ign.com/a', 'https://gamespot.com/b'], {
      fetchImpl: fakeFetch({
        'https://www.ign.com/a': () => new Response(htmlWith('https://cdn/a.jpg'), { headers: { 'content-type': 'text/html' } }),
        'https://gamespot.com/b': () => new Response(htmlWith('https://cdn/b.jpg'), { headers: { 'content-type': 'text/html; charset=utf-8' } }),
      }),
    });
    expect(out.map((c) => c.url)).toEqual(['https://cdn/a.jpg', 'https://cdn/b.jpg']);
    expect(out[0]).toMatchObject({ provider: 'source-page', attribution: 'Imagem: ign.com', license: 'source' });
  });

  it('falha de uma página (rede, 404, não-HTML) só pula aquela página', async () => {
    const out = await fetchSourceImages(['https://a.com/1', 'https://b.com/2', 'https://c.com/3', 'https://d.com/4'], {
      fetchImpl: fakeFetch({
        'https://a.com/1': () => Promise.reject(new Error('ECONNRESET')),
        'https://b.com/2': () => new Response('nao achei', { status: 404 }),
        'https://c.com/3': () => new Response('%PDF', { headers: { 'content-type': 'application/pdf' } }),
        'https://d.com/4': () => new Response(htmlWith('https://cdn/d.jpg'), { headers: { 'content-type': 'text/html' } }),
      }),
    });
    expect(out.map((c) => c.url)).toEqual(['https://cdn/d.jpg']);
  });

  it('respeita o limite de páginas e ignora URL repetida', async () => {
    const seen: string[] = [];
    await fetchSourceImages(['https://a.com/1', 'https://a.com/1', 'https://b.com/2', 'https://c.com/3'], {
      limit: 2,
      fetchImpl: (async (input: string | URL | Request) => {
        seen.push(String(input));
        return new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
      }) as typeof fetch,
    });
    expect(seen).toEqual(['https://a.com/1', 'https://b.com/2']);
  });

  it('para de ler no </head> em vez de baixar a página inteira', async () => {
    const big = `<html><head><meta property="og:image" content="https://cdn/x.jpg"></head><body>${'x'.repeat(2_000_000)}</body>`;
    const out = await fetchSourceImages(['https://a.com/1'], {
      fetchImpl: (async () => new Response(big, { headers: { 'content-type': 'text/html' } })) as typeof fetch,
    });
    expect(out).toHaveLength(1);
  });
});
