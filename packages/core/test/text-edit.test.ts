import { describe, expect, it } from 'vitest';
import {
  applyTextEdits,
  embedBlock,
  findEditableTexts,
  gutenbergImageBlock,
  markEditableTexts,
  plainText,
  splitArticle,
  updateImageBlockSeo,
} from '../src';

const P = (t: string) => `<!-- wp:paragraph -->\n<p>${t}</p>\n<!-- /wp:paragraph -->`;
const H = (t: string) => `<!-- wp:heading {"level":3} -->\n<h3 class="wp-block-heading">${t}</h3>\n<!-- /wp:heading -->`;
const LIST = `<!-- wp:list -->\n<ul class="wp-block-list"><!-- wp:list-item --><li>primeiro item</li><!-- /wp:list-item --><!-- wp:list-item --><li>segundo <strong>item</strong></li><!-- /wp:list-item --></ul>\n<!-- /wp:list -->`;

const ARTICLE = [
  P('Abertura com <a href="https://ign.com/x" target="_blank" rel="noopener">um link</a> e texto.'),
  H('Como ativar'),
  gutenbergImageBlock({ url: 'https://blog.example/a.webp', alt: 'aba de amigos', caption: 'Fonte: IGN', mediaId: 11 }),
  P('Segundo parágrafo.'),
  LIST,
  embedBlock({ kind: 'youtube', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' }),
  '<!-- CP-BLOCK:START --><p>Widget gerenciado pelo sistema</p><!-- CP-BLOCK:END -->',
  P('Fecho.'),
].join('\n');

describe('findEditableTexts', () => {
  it('acha parágrafos, títulos e itens de lista, na ordem, e ignora imagem, embed e o bloco gerenciado', () => {
    const items = findEditableTexts(ARTICLE);
    expect(items.map((i) => `${i.tag}:${plainText(i.inner)}`)).toEqual([
      'p:Abertura com um link e texto.',
      'h3:Como ativar',
      'p:Segundo parágrafo.',
      'li:primeiro item',
      'li:segundo item',
      'p:Fecho.',
    ]);
    expect(items.map((i) => i.index)).toEqual([0, 1, 2, 3, 4, 5]);
    // o legenda da imagem e o widget não são editáveis
    expect(items.some((i) => plainText(i.inner).includes('Fonte: IGN'))).toBe(false);
    expect(items.some((i) => plainText(i.inner).includes('Widget'))).toBe(false);
  });

  it('lista dentro de lista não é editável (nem o pai nem o filho): só o que é texto simples', () => {
    const html = '<ul><li>pai <ul><li>filho</li></ul></li></ul><p>solto</p>';
    expect(findEditableTexts(html).map((i) => plainText(i.inner))).toEqual(['solto']);
  });

  it('HTML de editor clássico (sem comentários de bloco) também funciona', () => {
    expect(findEditableTexts('<p>um</p>\n<p>dois</p>').map((i) => plainText(i.inner))).toEqual(['um', 'dois']);
  });

  it('código, tabela e HTML solto ficam de fora', () => {
    const html = '<!-- wp:code -->\n<pre><code>x</code></pre>\n<!-- /wp:code -->\n<!-- wp:html -->\n<p>html solto</p>\n<!-- /wp:html -->\n<p>texto</p>';
    expect(findEditableTexts(html).map((i) => plainText(i.inner))).toEqual(['texto']);
  });
});

describe('markEditableTexts', () => {
  it('marca só os editáveis com o índice, sem quebrar o HTML nem os atributos existentes', () => {
    const marked = markEditableTexts(ARTICLE);
    expect(marked).toContain('<p data-edit-index="0">');
    expect(marked).toContain('<h3 class="wp-block-heading" data-edit-index="1">');
    expect(marked).toContain('<li data-edit-index="4">');
    expect(marked).toContain('<p data-edit-index="5">Fecho.</p>');
    // o widget e a imagem seguem intocados
    expect(marked).toContain('<!-- CP-BLOCK:START --><p>Widget gerenciado pelo sistema</p>');
    // a marcação não muda quantos trechos existem nem a ordem
    expect(findEditableTexts(marked).map((i) => plainText(i.inner))).toEqual(findEditableTexts(ARTICLE).map((i) => plainText(i.inner)));
    // e a marcação some ao tirar o atributo
    expect(marked.replace(/ data-edit-index="\d+"/g, '')).toBe(ARTICLE);
  });

  it('os índices da tela batem com os do servidor depois de separar o artigo em blocos', () => {
    const segments = splitArticle(markEditableTexts(ARTICLE));
    const seen = segments.flatMap((s) => (s.kind === 'html' ? [...s.html.matchAll(/data-edit-index="(\d+)"/g)].map((m) => Number(m[1])) : []));
    expect(seen).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('applyTextEdits', () => {
  it('troca só o trecho editado e deixa todo o resto do HTML idêntico', () => {
    const r = applyTextEdits(ARTICLE, [
      { index: 2, beforeText: 'Segundo parágrafo.', afterHtml: 'Segundo parágrafo, agora revisado.' },
    ]);
    expect(r).toMatchObject({ ok: true, changed: 1 });
    if (!r.ok) return;
    expect(r.html).toContain('<p>Segundo parágrafo, agora revisado.</p>');
    expect(r.html).toBe(ARTICLE.replace('<p>Segundo parágrafo.</p>', '<p>Segundo parágrafo, agora revisado.</p>'));
  });

  it('preserva o link do parágrafo editado quando a marcação vem junto', () => {
    const r = applyTextEdits(ARTICLE, [
      {
        index: 0,
        beforeText: 'Abertura com um link e texto.',
        afterHtml: 'Nova abertura com <a href="https://ign.com/x" target="_blank" rel="noopener">um link</a> e texto melhor.',
      },
    ]);
    expect(r.ok && r.html).toContain('href="https://ign.com/x"');
    expect(r.ok && r.html).toContain('Nova abertura com');
  });

  it('várias edições de uma vez, em qualquer ordem, sem desalinhar as posições', () => {
    const r = applyTextEdits(ARTICLE, [
      { index: 5, beforeText: 'Fecho.', afterHtml: 'Fecho bem mais longo do que antes, com muito mais texto para deslocar as posições.' },
      { index: 1, beforeText: 'Como ativar', afterHtml: 'Como ativar o recurso' },
      { index: 3, beforeText: 'primeiro item', afterHtml: 'item um' },
    ]);
    expect(r).toMatchObject({ ok: true, changed: 3 });
    if (!r.ok) return;
    expect(findEditableTexts(r.html).map((i) => plainText(i.inner))).toEqual([
      'Abertura com um link e texto.',
      'Como ativar o recurso',
      'Segundo parágrafo.',
      'item um',
      'segundo item',
      'Fecho bem mais longo do que antes, com muito mais texto para deslocar as posições.',
    ]);
  });

  it('se alguém mudou o trecho no WordPress enquanto o usuário editava, recusa TUDO (nada é sobrescrito)', () => {
    const r = applyTextEdits(ARTICLE, [
      { index: 5, beforeText: 'Fecho.', afterHtml: 'Fecho novo.' },
      { index: 2, beforeText: 'Segundo parágrafo ANTIGO.', afterHtml: 'X' },
    ]);
    expect(r).toEqual({ ok: false, reason: 'conflict', index: 2 });
  });

  it('índice que não existe mais e trecho esvaziado são recusados', () => {
    expect(applyTextEdits(ARTICLE, [{ index: 99, beforeText: 'x', afterHtml: 'y' }])).toEqual({ ok: false, reason: 'missing', index: 99 });
    expect(applyTextEdits(ARTICLE, [{ index: 5, beforeText: 'Fecho.', afterHtml: '  <b> </b> ' }])).toEqual({ ok: false, reason: 'empty', index: 5 });
  });

  it('edição idêntica ao que já estava não conta como mudança', () => {
    const r = applyTextEdits(ARTICLE, [{ index: 5, beforeText: 'Fecho.', afterHtml: 'Fecho.' }]);
    expect(r).toMatchObject({ ok: true, changed: 0 });
    expect(r.ok && r.html).toBe(ARTICLE);
  });

  it('tag de texto no meio de uma palavra não a parte: "pala<b>vra</b>" é "palavra" para quem compara', () => {
    const html = '<p>Uma pala<b>vra</b> em destaque.</p>';
    expect(plainText(findEditableTexts(html)[0]!.inner)).toBe('Uma palavra em destaque.');
    // o navegador devolve o texto sem marcação, e a comparação bate
    expect(applyTextEdits(html, [{ index: 0, beforeText: 'Uma palavra em destaque.', afterHtml: 'Outra.' }])).toMatchObject({ ok: true, changed: 1 });
  });

  it('o beforeText tolera espaços e quebras de linha diferentes (o navegador reformata o texto)', () => {
    const r = applyTextEdits(ARTICLE, [{ index: 2, beforeText: '  Segundo\n  parágrafo. ', afterHtml: 'Novo.' }]);
    expect(r).toMatchObject({ ok: true, changed: 1 });
  });
});

describe('updateImageBlockSeo', () => {
  it('muda alt e legenda mantendo o anexo e a URL, e sem tocar no resto do post', () => {
    const r = updateImageBlockSeo(ARTICLE, 11, { alt: 'Aba de amigos do Roblox aberta no celular', caption: 'Imagem: Roblox' });
    expect(r.replaced).toBe(true);
    expect(r.url).toBe('https://blog.example/a.webp');
    const img = splitArticle(r.html).find((s) => s.kind === 'image');
    expect(img).toMatchObject({ mediaId: 11, url: 'https://blog.example/a.webp', alt: 'Aba de amigos do Roblox aberta no celular', caption: 'Imagem: Roblox' });
    expect(r.html).not.toContain('Fonte: IGN');
    expect(r.html).toContain('Segundo parágrafo.');
  });

  it('legenda vazia remove o figcaption', () => {
    const r = updateImageBlockSeo(ARTICLE, 11, { alt: 'x', caption: '' });
    expect(r.html).not.toContain('figcaption');
  });

  it('imagem que não está no post: nada muda', () => {
    const r = updateImageBlockSeo(ARTICLE, 999, { alt: 'x', caption: 'y' });
    expect(r).toMatchObject({ replaced: false, html: ARTICLE, url: null });
  });
});
