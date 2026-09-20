/**
 * O que veio de um arrastar-e-soltar ou de uma colagem: um arquivo de imagem, ou o endereço de uma
 * imagem da web. Funções puras sobre o que o navegador entrega (`DataTransfer`), para testar sem
 * navegador. Só http(s): `javascript:`, `data:` e `file:` nunca viram endereço de imagem.
 */

export interface DroppedImage {
  file?: File;
  url?: string;
}

const IMAGE_URL = /^https?:\/\/\S+$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i;

interface TransferLike {
  files?: ArrayLike<File> | null;
  getData(format: string): string;
}

/** Arquivo de imagem solto, ou o endereço de uma imagem arrastada de outra página. */
export function imageFromTransfer(dt: TransferLike): DroppedImage | null {
  const file = Array.from(dt.files ?? []).find((f) => f.type.startsWith('image/'));
  if (file) return { file };

  const uri = dt.getData('text/uri-list').split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
  if (uri && IMAGE_URL.test(uri)) return { url: uri };

  // arrastar uma <img> de outra aba costuma trazer só o HTML dela
  const html = dt.getData('text/html');
  const src = /<img\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/i.exec(html)?.[1]?.replace(/&amp;/g, '&');
  if (src && IMAGE_URL.test(src)) return { url: src };
  return null;
}

interface ClipboardLike extends TransferLike {
  items?: ArrayLike<{ kind: string; type: string; getAsFile(): File | null }> | null;
}

/** Imagem colada (captura de tela, "copiar imagem"), ou um endereço de imagem colado como texto. */
export function imageFromClipboard(cd: ClipboardLike): DroppedImage | null {
  const item = Array.from(cd.items ?? []).find((i) => i.kind === 'file' && i.type.startsWith('image/'));
  const file = item?.getAsFile();
  if (file) return { file };
  const text = cd.getData('text/plain').trim();
  if (IMAGE_URL.test(text) && IMAGE_EXT.test(text)) return { url: text };
  return null;
}

/** Nome de arquivo que vale como base do nome no WordPress; nomes genéricos de colagem não valem. */
export function usefulFileName(name: string): string {
  const base = name.replace(/\.[a-z0-9]{2,5}$/i, '').trim();
  if (!base) return '';
  if (/^(image|imagem|screenshot|captura|clipboard|unnamed|blob|download|untitled|sem[- ]t[ií]tulo)/i.test(base)) return '';
  if (/^[\d\s._-]+$/.test(base)) return '';
  return base;
}
