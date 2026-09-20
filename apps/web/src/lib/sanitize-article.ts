import sanitizeHtml from 'sanitize-html';

/**
 * Sanitiza um trecho de texto do artigo antes de exibi-lo na tela de preview.
 *
 * O HTML vem do WordPress, onde qualquer editor do site pode tê-lo alterado, e é
 * renderizado dentro do painel logado: sem isto um `<script>` ou `onerror=` no post
 * rodaria com a sessão do usuário. Só ficam as tags de texto e os atributos que
 * o preview precisa; comentários de bloco do Gutenberg caem junto.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'a', 'strong', 'em', 'b', 'i', 'u',
    'br', 'hr', 'code', 'pre', 'sup', 'sub', 'span', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'figure', 'figcaption',
    'img',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height'],
    th: ['colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  transformTags: {
    // link do artigo abre em outra aba, sem repassar a janela do painel
    a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer nofollow' }),
  },
};

export function sanitizeArticleHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS);
}
