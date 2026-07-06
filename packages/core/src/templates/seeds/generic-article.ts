import type { TemplateConfig } from '../schema';

/**
 * Template builtin "Artigo genérico" — sem extração de dados nem widget.
 * Prova que o sistema não é acoplado ao nicho de games: serve para qualquer
 * assunto (o prompt é o generalPrompt do workflow n8n, generalizado).
 */

const UPDATE_PROMPT_PT = `Você é um editor especialista do blog {{siteName}}.
Hoje é {{today}}.

CONTEÚDO ATUAL DO POST "{{postTitle}}" (HTML Gutenberg completo):
{{currentHtml}}

RESULTADOS DA BUSCA WEB (conteúdo completo/raw_content das páginas):
{{searchContext}}

TAREFA:
1. Adicione novidades relevantes encontradas nas fontes ao conteúdo do post.
2. Mantenha TODOS os comentários de blocos Gutenberg do HTML original.
3. NÃO coloque o título dentro do updatedHtml.
4. Atualize o mês/ano no título se necessário.
5. NÃO escreva placeholders, reticências ou resumos no lugar do conteúdo original.
6. NÃO use tags <script> ou <style>.
7. Se não houver nada relevante para adicionar, defina hasChanges: false.

FORMATO DA RESPOSTA (obrigatório):
- Responda exclusivamente com um objeto JSON válido, sem markdown, sem texto antes ou depois.

CAMPOS DA RESPOSTA:
- action: use sempre "update".
- noDataFound: use sempre false.
- data: objeto vazio {}.
- newTitle: título atualizado ou igual ao atual.
- updatedHtml: HTML original com novidades adicionadas, blocos Gutenberg preservados.
- changesSummary: o que foi adicionado.`;

const GENERATE_PROMPT_PT = `Você é um editor especialista do blog {{siteName}}.
Hoje é {{today}}.
Escreva um artigo NOVO sobre: "{{topic}}".

{{extraInstructions}}

RESULTADOS DA BUSCA WEB (conteúdo completo das páginas; base factual do artigo — não invente fatos):
{{searchContext}}

REGRAS:
- Estruture com introdução direta, seções com headings h3 e conclusão curta.
- Baseie afirmações factuais nas fontes acima; não invente números, datas ou citações.
- Blocos Gutenberg obrigatórios: <!-- wp:paragraph -->, <!-- wp:list -->, <!-- wp:heading {"level":3} -->.
- NÃO coloque o título dentro do updatedHtml; sem <script>/<style>; sem placeholders.
- data: objeto vazio {}. noDataFound: false. action: "update". hasChanges: true.
- newTitle: título SEO claro para o artigo.
- changesSummary: resumo em 1 linha do artigo criado.

FORMATO DA RESPOSTA: exclusivamente um objeto JSON válido, sem markdown.`;

export const genericArticleTemplate = {
  slug: 'generic-article',
  name: 'Artigo genérico',
  description:
    'Atualiza ou gera artigos sobre qualquer assunto com base em fontes reais pesquisadas na web. Sem extração de dados estruturados nem widget.',
  config: {
    defaultLanguage: 'pt-BR',
    topic: { stripPatterns: [], cutAt: [] },
    queries: [
      { name: 'main', locale: 'pt-BR', template: '{{topic}} {{monthYear}}' },
      { name: 'recent', locale: 'pt-BR', template: '{{topic}} novidades atualizado {{monthYear}}' },
    ],
    sources: {
      blocklist: ['youtube.com', 'youtu.be', 'tiktok.com', 'instagram.com', 'facebook.com', 'twitter.com', 'x.com', 'reddit.com'],
      trustlist: [],
      sourceLimit: 12,
      perQueryQuota: 6,
      perSourceCharLimit: 30_000,
      contextCharLimit: 120_000,
    },
    prompts: {
      'pt-BR': {
        update: UPDATE_PROMPT_PT,
        generate: GENERATE_PROMPT_PT,
      },
    },
    extraction: {
      enabled: false,
      dataSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      verbatimLists: [],
      valuePattern: '^[A-Za-z0-9!?_@#.\\-]{2,40}$',
      minSourcesForEmptyClaim: 3,
    },
    managedBlock: { enabled: false, markerPrefix: 'CP-BLOCK', rendererId: '', legacySignatures: [] },
    validation: { titleMin: 10, titleMax: 120, htmlMinChars: 200 },
    llmDefaults: { generateMaxTokens: 16_000, generateTemperature: 0.2, verifyMaxTokens: 8_000, verifyTemperature: 0 },
  } satisfies TemplateConfig,
};
