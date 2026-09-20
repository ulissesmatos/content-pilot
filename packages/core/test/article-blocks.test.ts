import { describe, expect, it } from 'vitest';
import {
  embedBlock,
  gutenbergImageBlock,
  imageBlockMediaId,
  injectAfterParagraphs,
  parseEditorialReport,
  parseImageReport,
  replaceImageBlock,
  splitArticle,
  withReplacedImage,
  type ImageReport,
  type ImageReportItem,
} from '../src';

const P = (t: string) => `<!-- wp:paragraph --><p>${t}</p><!-- /wp:paragraph -->`;
const H = (t: string) => `<!-- wp:heading {"level":3} --><h3 class="wp-block-heading">${t}</h3><!-- /wp:heading -->`;

const article = () => {
  let html = [P('Primeiro parágrafo.'), H('Seção'), P('Segundo parágrafo.'), P('Terceiro parágrafo.')].join('\n');
  html = injectAfterParagraphs(html, [
    { afterParagraph: 0, image: { url: 'https://blog.example/a.webp', alt: 'Capa & "aspas"', caption: 'Fonte: IGN', mediaId: 11 } },
  ]);
  return html;
};

describe('splitArticle', () => {
  it('separa texto, imagem e embed na ordem, sem trechos vazios', () => {
    const html =
      article() +
      embedBlock({ kind: 'youtube', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' }) +
      embedBlock({ kind: 'tweet', url: 'https://twitter.com/Roblox/status/1700000000000000001' });
    const segs = splitArticle(html);
    expect(segs.map((s) => s.kind)).toEqual(['html', 'image', 'html', 'embed', 'embed']);

    const img = segs[1]!;
    expect(img).toMatchObject({ kind: 'image', mediaId: 11, url: 'https://blog.example/a.webp', caption: 'Fonte: IGN' });
    // entidades do atributo voltam ao texto original
    expect((img as { alt: string }).alt).toBe('Capa & "aspas"');

    expect(segs[3]).toMatchObject({ kind: 'embed', provider: 'youtube', id: 'aaaaaaaaaaa' });
    expect(segs[4]).toMatchObject({ kind: 'embed', provider: 'tweet', id: '1700000000000000001' });
  });

  it('bloco de embed de outro provedor vira "other" e não quebra', () => {
    const segs = splitArticle(embedBlock({ kind: 'youtube', url: 'https://vimeo.com/123' }));
    expect(segs).toEqual([{ kind: 'embed', provider: 'other', url: 'https://vimeo.com/123', id: null }]);
  });

  it('embed antigo, sem a URL no atributo, usa o texto do wrapper', () => {
    const html =
      '<!-- wp:embed -->\n<figure class="wp-block-embed"><div class="wp-block-embed__wrapper">\nhttps://www.youtube.com/watch?v=bbbbbbbbbbb\n</div></figure>\n<!-- /wp:embed -->';
    expect(splitArticle(html)).toMatchObject([{ kind: 'embed', provider: 'youtube', id: 'bbbbbbbbbbb' }]);
  });

  it('id do anexo: atributo do bloco, senão a classe wp-image', () => {
    expect(imageBlockMediaId({ id: 7 }, '')).toBe(7);
    expect(imageBlockMediaId({}, '<img class="wp-image-42 aligncenter" src="x"/>')).toBe(42);
    expect(imageBlockMediaId({}, '<img src="x"/>')).toBeNull();
  });

  it('HTML sem blocos de imagem/embed devolve um único trecho', () => {
    expect(splitArticle('<p>só texto</p>')).toEqual([{ kind: 'html', html: '<p>só texto</p>' }]);
    expect(splitArticle('')).toEqual([]);
  });
});

describe('replaceImageBlock', () => {
  it('troca a imagem pelo id, no mesmo lugar, sem deixar o id ou a URL antigos', () => {
    const before = article();
    const { html, replaced } = replaceImageBlock(before, 11, {
      url: 'https://blog.example/novo.webp',
      alt: 'Nova',
      mediaId: 22,
    });
    expect(replaced).toBe(true);
    expect(html).not.toContain('wp-image-11');
    expect(html).not.toContain('"id":11');
    expect(html).not.toContain('a.webp');
    expect(html).toContain('wp-image-22');
    expect(html).toContain('novo.webp');
    // a legenda do original era de uma fonte; a nova imagem não a herda
    expect(html).not.toContain('Fonte: IGN');
    // o texto em volta e a ordem ficam iguais
    const seg = splitArticle(html);
    expect(seg.map((s) => s.kind)).toEqual(['html', 'image', 'html']);
    expect(seg[1]).toMatchObject({ mediaId: 22 });
  });

  it('id que não está no post: nada muda e diz que não trocou', () => {
    const before = article();
    const out = replaceImageBlock(before, 999, { url: 'https://x/y.webp', alt: '', mediaId: 5 });
    expect(out.replaced).toBe(false);
    expect(out.html).toBe(before);
  });

  it('só troca a imagem pedida quando há mais de uma', () => {
    let html = [P('a'), P('b'), P('c')].join('\n');
    html = injectAfterParagraphs(html, [
      { afterParagraph: 0, image: { url: 'https://x/1.webp', alt: 'um', mediaId: 1 } },
      { afterParagraph: 1, image: { url: 'https://x/2.webp', alt: 'dois', mediaId: 2 } },
    ]);
    const out = replaceImageBlock(html, 2, { url: 'https://x/3.webp', alt: 'tres', mediaId: 3 });
    const ids = splitArticle(out.html).flatMap((s) => (s.kind === 'image' ? [s.mediaId] : []));
    expect(ids).toEqual([1, 3]);
    expect(gutenbergImageBlock({ url: 'u', alt: 'a', mediaId: 3 })).toContain('wp-image-3');
  });
});

const item = (over: Partial<ImageReportItem>): ImageReportItem => ({
  slotId: 'cover',
  role: 'cover',
  origin: 'search',
  mediaId: 1,
  url: 'https://x/c.webp',
  alt: 'c',
  ...over,
});

describe('relatório de imagens', () => {
  it('a imagem gerada substitui a do mesmo slot e a capa que faltava deixa de faltar', () => {
    const report: ImageReport = {
      coverMissing: true,
      plannedInline: 2,
      images: [item({ slotId: 'inline-2', role: 'inline', mediaId: 5 })],
      notes: ['cover: sem imagem'],
    };
    const withCover = withReplacedImage(report, item({ origin: 'generated', mediaId: 9 }));
    expect(withCover.coverMissing).toBe(false);
    expect(withCover.images.map((i) => i.slotId)).toEqual(['cover', 'inline-2']); // capa primeiro
    expect(withCover.notes).toEqual(['cover: sem imagem']);

    const swapped = withReplacedImage(withCover, item({ slotId: 'inline-2', role: 'inline', origin: 'generated', mediaId: 6 }));
    expect(swapped.images).toHaveLength(2);
    expect(swapped.images.find((i) => i.slotId === 'inline-2')).toMatchObject({ mediaId: 6, origin: 'generated' });
  });

  it('ordena slots numericamente (inline-10 depois de inline-2)', () => {
    let r = withReplacedImage(
      { coverMissing: true, plannedInline: 0, images: [], notes: [] },
      item({ slotId: 'inline-10', role: 'inline', mediaId: 10 }),
    );
    r = withReplacedImage(r, item({ slotId: 'inline-2', role: 'inline', mediaId: 2 }));
    expect(r.images.map((i) => i.slotId)).toEqual(['inline-2', 'inline-10']);
  });

  it('parseImageReport aguenta null, lixo e itens tortos', () => {
    expect(parseImageReport(null).images).toEqual([]);
    expect(parseImageReport('x').coverMissing).toBe(false);
    const r = parseImageReport({ images: [item({}), { slotId: 1 }, null], plannedInline: 'x', notes: ['a', 3] });
    expect(r.images).toHaveLength(1);
    expect(r.coverMissing).toBe(false);
    expect(r.plannedInline).toBe(0);
    expect(r.notes).toEqual(['a']);
    expect(parseImageReport({ images: [] }).coverMissing).toBe(true);
  });
});

describe('parseEditorialReport', () => {
  it('lê revisão e embeds válidos e descarta o que vier torto', () => {
    const r = parseEditorialReport({
      review: {
        status: 'revised',
        changes: [{ kind: 'dull', section: 'Intro', note: 'mais direto' }, { kind: 'zzz', note: 'x' }, 7],
        reason: null,
        remainingTells: ['vale ressaltar', 3],
      },
      embeds: [
        { kind: 'youtube', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', id: 'aaaaaaaaaaa', title: 't', author: 'a' },
        { kind: 'x' },
      ],
      embedNotes: ['ok', 1],
    });
    expect(r?.review?.status).toBe('revised');
    expect(r?.review?.changes).toEqual([{ kind: 'dull', section: 'Intro', note: 'mais direto' }]);
    expect(r?.review?.remainingTells).toEqual(['vale ressaltar']);
    expect(r?.embeds).toHaveLength(1);
    expect(r?.embedNotes).toEqual(['ok']);
  });

  it('sem relatório (posts antigos) devolve null; status desconhecido não vira revisão', () => {
    expect(parseEditorialReport(null)).toBeNull();
    expect(parseEditorialReport({ review: { status: 'weird' }, embeds: [] })?.review).toBeNull();
  });
});
