import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeArticleHtml } from '../src/lib/sanitize-article';

test('remove script, handlers de evento e URL javascript:', () => {
  const out = sanitizeArticleHtml(
    '<p onclick="x()">oi</p><script>alert(1)</script><a href="javascript:alert(1)">clique</a><img src="x" onerror="alert(1)">',
  );
  assert.ok(!/script|onclick|onerror|javascript:/i.test(out), out);
  assert.match(out, /<p>oi<\/p>/);
});

test('mantém texto, títulos, listas e link, e o link abre em outra aba com rel seguro', () => {
  const out = sanitizeArticleHtml('<h2>Título</h2><ul><li>um</li></ul><p><a href="https://ign.com/x">IGN</a></p>');
  assert.match(out, /<h2>Título<\/h2>/);
  assert.match(out, /<li>um<\/li>/);
  assert.match(out, /href="https:\/\/ign\.com\/x"/);
  assert.match(out, /rel="noopener noreferrer nofollow"/);
  assert.match(out, /target="_blank"/);
});

test('comentários de bloco do Gutenberg não sobram na saída', () => {
  const out = sanitizeArticleHtml('<!-- wp:paragraph --><p>texto</p><!-- /wp:paragraph -->');
  assert.equal(out, '<p>texto</p>');
});

test('imagem só com http(s); data: e iframe são descartados', () => {
  const out = sanitizeArticleHtml('<img src="data:text/html;base64,AAAA"><iframe src="https://evil.example"></iframe><img src="https://a.example/i.webp" alt="ok">');
  assert.ok(!out.includes('data:'), out);
  assert.ok(!out.includes('iframe'), out);
  assert.match(out, /src="https:\/\/a\.example\/i\.webp"/);
});
