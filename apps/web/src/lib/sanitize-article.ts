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
    // qual trecho do HTML cada elemento representa, para a edição de texto (ver markEditableTexts)
    p: ['data-edit-index'],
    h1: ['data-edit-index'],
    h2: ['data-edit-index'],
    h3: ['data-edit-index'],
    h4: ['data-edit-index'],
    h5: ['data-edit-index'],
    h6: ['data-edit-index'],
    li: ['data-edit-index'],
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

/**
 * Sanitiza o conteúdo de UM trecho de texto editado pelo usuário (o que vem do contentEditable).
 * Só marcação de texto: negrito, itálico, link, código, sobrescrito. O navegador pode enfiar
 * `<div>`, `<span style>` e `&nbsp;` ao editar; tudo isso sai. Quebra de linha só em parágrafo.
 */
export function sanitizeInlineHtml(html: string, opts: { allowBreaks: boolean }): string {
  return sanitizeHtml(html.replace(/&nbsp;|\u00a0/g, ' '), {
    allowedTags: ['a', 'strong', 'em', 'b', 'i', 'code', 'sup', 'sub', ...(opts.allowBreaks ? ['br'] : [])],
    allowedAttributes: { a: ['href', 'title', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    // <span>, <div>, <font> e afins somem e ficam só com o texto
    disallowedTagsMode: 'discard',
  })
    .replace(/\s+/g, ' ')
    .trim();
}
