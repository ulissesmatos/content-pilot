/**
 * Bloco gerenciado: HTML auto-contido (ex.: widget de códigos) que o sistema
 * injeta no post entre marcadores estáveis. O strip antes de cada execução +
 * marcadores tornam a re-injeção idempotente.
 *
 * Porta exata do stripWidget do workflow n8n v4, generalizando:
 * - "DG-CODES-WIDGET" → markerPrefix do template
 * - "dg-codes-widget" → legacySignatures (strings que identificam o bloco em
 *   formatos antigos sem marcador)
 */

export interface ManagedBlockConfig {
  markerPrefix: string;
  /** Assinaturas de versões legadas do bloco (ex.: classe CSS do widget antigo). */
  legacySignatures?: string[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function stripManagedBlock(html: string, cfg: ManagedBlockConfig): string {
  if (!html) return '';
  const prefix = escapeRegExp(cfg.markerPrefix);
  let out = html;

  // Formato novo: marcadores explícitos (com ou sem wrapper wp:html)
  out = out.replace(
    new RegExp(
      `<!-- wp:html -->\\s*<!-- ${prefix}:START -->[\\s\\S]*?<!-- ${prefix}:END -->\\s*<!-- \\/wp:html -->`,
      'g',
    ),
    '',
  );
  out = out.replace(new RegExp(`<!-- ${prefix}:START -->[\\s\\S]*?<!-- ${prefix}:END -->`, 'g'), '');

  const signatures = cfg.legacySignatures ?? [];
  if (signatures.length > 0) {
    // Formato legado dentro de wp:html: varredura bloco a bloco
    // (regex gulosa engoliria conteúdo legítimo entre blocos)
    const OPEN = '<!-- wp:html -->';
    const CLOSE = '<!-- /wp:html -->';
    let idx = 0;
    let result = '';
    for (;;) {
      const start = out.indexOf(OPEN, idx);
      if (start === -1) {
        result += out.slice(idx);
        break;
      }
      const end = out.indexOf(CLOSE, start);
      if (end === -1) {
        result += out.slice(idx);
        break;
      }
      const block = out.slice(start, end + CLOSE.length);
      result += out.slice(idx, start);
      if (!signatures.some((s) => block.includes(s))) result += block;
      idx = end + CLOSE.length;
    }
    out = result;

    // Bloco legado solto (sem wrapper): o </script></div> final delimita o fim real
    for (const sig of signatures) {
      out = out.replace(
        new RegExp(`<div class="${escapeRegExp(sig)}"[\\s\\S]*?<\\/script>\\s*<\\/div>`, 'g'),
        '',
      );
    }
  }

  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/** Envolve o HTML do bloco nos marcadores + wrapper wp:html. */
export function wrapManagedBlock(innerHtml: string, markerPrefix: string): string {
  return (
    `<!-- wp:html -->\n<!-- ${markerPrefix}:START -->\n` +
    innerHtml.trim() +
    `\n<!-- ${markerPrefix}:END -->\n<!-- /wp:html -->`
  );
}

/** Injeta o bloco logo após o primeiro parágrafo; sem parágrafo, prepende. */
export function injectManagedBlock(html: string, blockHtml: string): string {
  const anchor = '<!-- /wp:paragraph -->';
  const pos = html.indexOf(anchor);
  if (pos !== -1) {
    return html.slice(0, pos + anchor.length) + '\n\n' + blockHtml + '\n\n' + html.slice(pos + anchor.length);
  }
  return blockHtml + '\n\n' + html;
}

/** Texto limpo (sem tags/comentários) para classificação/preview — porta do cleanContent. */
export function htmlToCleanText(html: string, maxChars = 3000): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

/** Escape de HTML para valores vindos da web — nunca interpolar cru. */
export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
