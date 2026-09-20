import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageFromClipboard, imageFromTransfer, usefulFileName } from '../src/lib/image-drop';

/**
 * Arrastar e colar imagem sobre uma imagem do artigo. O navegador entrega coisas diferentes
 * conforme a origem: arquivo do computador, <img> de outra aba (só URL/HTML), captura de tela.
 */

const file = (name: string, type: string) => new File([new Uint8Array([1, 2, 3])], name, { type });
const transfer = (over: { files?: File[]; data?: Record<string, string> } = {}) => ({
  files: over.files ?? [],
  getData: (f: string) => over.data?.[f] ?? '',
});

test('arquivo de imagem do computador vence qualquer outra coisa', () => {
  const png = file('foto.png', 'image/png');
  assert.deepEqual(imageFromTransfer(transfer({ files: [png], data: { 'text/uri-list': 'https://a.example/x.jpg' } })), { file: png });
});

test('arquivo que não é imagem é ignorado (PDF, texto)', () => {
  assert.equal(imageFromTransfer(transfer({ files: [file('a.pdf', 'application/pdf')] })), null);
});

test('imagem arrastada de outra página: o endereço vem em text/uri-list', () => {
  const r = imageFromTransfer(transfer({ data: { 'text/uri-list': '# comentário\r\nhttps://cdn.example/foto.webp?w=800\r\n' } }));
  assert.deepEqual(r, { url: 'https://cdn.example/foto.webp?w=800' });
});

test('quando só vem o HTML da <img>, o src é extraído (com &amp; desfeito)', () => {
  const html = '<meta charset="utf-8"><img alt="x" src="https://cdn.example/a.jpg?x=1&amp;y=2" width="100">';
  assert.deepEqual(imageFromTransfer(transfer({ data: { 'text/html': html } })), { url: 'https://cdn.example/a.jpg?x=1&y=2' });
});

test('endereço que não é http(s) nunca vira imagem: javascript:, data:, file:', () => {
  for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'file:///C:/x.png']) {
    assert.equal(imageFromTransfer(transfer({ data: { 'text/uri-list': bad } })), null, bad);
    assert.equal(imageFromTransfer(transfer({ data: { 'text/html': `<img src="${bad}">` } })), null, bad);
  }
});

test('link solto que não é imagem (texto qualquer, link de página) não abre o diálogo', () => {
  assert.equal(imageFromTransfer(transfer({ data: { 'text/plain': 'olá' } })), null);
});

test('captura de tela colada: o arquivo vem dos itens da área de transferência', () => {
  const shot = file('image.png', 'image/png');
  const cd = { items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }, { kind: 'file', type: 'image/png', getAsFile: () => shot }], getData: () => '' };
  assert.deepEqual(imageFromClipboard(cd), { file: shot });
});

test('endereço de imagem colado como texto só vale se terminar em extensão de imagem', () => {
  const cd = (text: string) => ({ items: [], getData: () => text });
  assert.deepEqual(imageFromClipboard(cd('  https://cdn.example/foto.PNG?x=1  ')), { url: 'https://cdn.example/foto.PNG?x=1' });
  assert.equal(imageFromClipboard(cd('https://cdn.example/pagina')), null);
  assert.equal(imageFromClipboard(cd('só texto')), null);
});

test('nome de arquivo útil para o WordPress: descarta nomes genéricos de colagem e captura', () => {
  assert.equal(usefulFileName('Minha Foto Nova.PNG'), 'Minha Foto Nova');
  assert.equal(usefulFileName('image.png'), '');
  assert.equal(usefulFileName('Captura de tela 2026-09-20.png'), '');
  assert.equal(usefulFileName('Screenshot_20260920.png'), '');
  assert.equal(usefulFileName('20260920_123456.jpg'), '');
  assert.equal(usefulFileName(''), '');
});
