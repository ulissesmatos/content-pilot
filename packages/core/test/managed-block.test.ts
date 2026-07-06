import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  htmlToCleanText,
  injectManagedBlock,
  stripManagedBlock,
  wrapManagedBlock,
} from '../src/html/managed-block';

const CFG = { markerPrefix: 'DG-CODES-WIDGET', legacySignatures: ['dg-codes-widget'] };

const P1 = '<!-- wp:paragraph --><p>Intro do post.</p><!-- /wp:paragraph -->';
const P2 = '<!-- wp:paragraph --><p>Mais texto.</p><!-- /wp:paragraph -->';

describe('stripManagedBlock', () => {
  it('remove o formato novo com wrapper wp:html', () => {
    const widget = wrapManagedBlock('<div class="dg-codes-widget">w</div>', 'DG-CODES-WIDGET');
    const html = `${P1}\n\n${widget}\n\n${P2}`;
    const out = stripManagedBlock(html, CFG);
    expect(out).not.toContain('dg-codes-widget');
    expect(out).toContain('Intro do post.');
    expect(out).toContain('Mais texto.');
  });

  it('remove marcadores soltos sem wrapper', () => {
    const html = `${P1}\n<!-- DG-CODES-WIDGET:START --><div>x</div><!-- DG-CODES-WIDGET:END -->\n${P2}`;
    const out = stripManagedBlock(html, CFG);
    expect(out).not.toContain('DG-CODES-WIDGET');
  });

  it('remove bloco legado dentro de wp:html sem engolir wp:html legítimo', () => {
    const legit = '<!-- wp:html --><iframe src="https://ex.com"></iframe><!-- /wp:html -->';
    const legacy = '<!-- wp:html --><div class="dg-codes-widget">velho</div><!-- /wp:html -->';
    const html = `${P1}\n${legit}\n${legacy}\n${P2}`;
    const out = stripManagedBlock(html, CFG);
    expect(out).toContain('iframe');
    expect(out).not.toContain('dg-codes-widget');
  });

  it('remove widget legado solto delimitado por </script></div>', () => {
    const html = `${P1}\n<div class="dg-codes-widget"><style>.x{}</style><script>var a=1;</script></div>\n${P2}`;
    const out = stripManagedBlock(html, CFG);
    expect(out).not.toContain('dg-codes-widget');
    expect(out).toContain('Mais texto.');
  });

  it('é idempotente: strip(strip(x)) === strip(x)', () => {
    const widget = wrapManagedBlock('<div class="dg-codes-widget">w</div>', 'DG-CODES-WIDGET');
    const html = `${P1}\n${widget}\n${P2}`;
    const once = stripManagedBlock(html, CFG);
    expect(stripManagedBlock(once, CFG)).toBe(once);
  });
});

describe('injectManagedBlock', () => {
  it('injeta após o primeiro parágrafo', () => {
    const out = injectManagedBlock(`${P1}\n${P2}`, 'BLOCO');
    const posBloco = out.indexOf('BLOCO');
    expect(posBloco).toBeGreaterThan(out.indexOf('Intro do post.'));
    expect(posBloco).toBeLessThan(out.indexOf('Mais texto.'));
  });

  it('prepende quando não há parágrafo', () => {
    const out = injectManagedBlock('<!-- wp:heading --><h3>t</h3><!-- /wp:heading -->', 'BLOCO');
    expect(out.startsWith('BLOCO')).toBe(true);
  });

  it('strip + inject é um ciclo estável', () => {
    const widget = wrapManagedBlock('<div class="dg-codes-widget">w1</div>', 'DG-CODES-WIDGET');
    const v1 = injectManagedBlock(`${P1}\n${P2}`, widget);
    const stripped = stripManagedBlock(v1, CFG);
    const widget2 = wrapManagedBlock('<div class="dg-codes-widget">w2</div>', 'DG-CODES-WIDGET');
    const v2 = injectManagedBlock(stripped, widget2);
    expect(v2).toContain('w2');
    expect(v2).not.toContain('w1');
    expect((v2.match(/DG-CODES-WIDGET:START/g) ?? []).length).toBe(1);
  });
});

describe('helpers', () => {
  it('htmlToCleanText remove tags e comentários', () => {
    expect(htmlToCleanText('<!-- wp:paragraph --><p>Oi <b>mundo</b></p><!-- /wp:paragraph -->')).toBe('Oi mundo');
  });

  it('escapeHtml neutraliza payloads da web', () => {
    expect(escapeHtml('<img onerror="alert(1)">')).toBe('&lt;img onerror=&quot;alert(1)&quot;&gt;');
  });
});
