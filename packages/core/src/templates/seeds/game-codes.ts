import type { TemplateConfig } from '../schema';

/**
 * Template builtin "Códigos de jogos" — porta do workflow n8n v4 do DeepGames.
 * Prompts, listas de fontes e schema de extração idênticos ao original, com o
 * domínio parametrizado ({{topic}}, {{siteName}}, datas por locale).
 */

const UPDATE_PROMPT_PT = `Você é um editor especialista de blog de games ({{siteName}}).
Hoje é {{today}}.
Mês atual do post: {{monthYear}}. Mês anterior também considerado para códigos ainda válidos: {{prevMonthYear}}.
O post é sobre códigos do jogo "{{topic}}".

CONTEÚDO ATUAL DO POST (HTML Gutenberg; o widget de códigos já foi removido e é gerenciado automaticamente pelo sistema):
{{currentHtml}}

RESULTADOS DA BUSCA WEB (conteúdo completo/raw_content das páginas; única fonte permitida para códigos):
{{searchContext}}

TAREFA PRINCIPAL:
Garantir qualidade editorial e códigos corretos. Avalie o post atual e escolha UMA ação (campo "action"):

AÇÃO "update" — post está bom, só precisa de ajustes:
- Use quando o post já tem estrutura adequada e texto que faz sentido.
- Atualize apenas a data "Última atualização:" se aparecer no texto e mantenha o resto do updatedHtml quase integralmente.

AÇÃO "reorganize" — post tem conteúdo útil mas mal estruturado:
- Reescreva o updatedHtml reorganizando em ordem lógica:
  1. Parágrafo introdutório sobre o jogo (2-3 frases, SEO)
  2. Como resgatar os códigos (passo a passo curto numerado)
  3. Onde encontrar novos códigos (1 parágrafo)

AÇÃO "rewrite" — post vazio, sem sentido ou muito ruim:
- Crie um updatedHtml completo do zero:
  1. Parágrafo introdutório sobre o jogo (2-3 frases com a keyword principal, tom direto, sem enrolação)
  2. Como resgatar os códigos (passo a passo de 4-5 passos numerados)
  3. Onde encontrar novos códigos (1 parágrafo mencionando redes sociais oficiais do jogo e sites de referência)

SOBRE O WIDGET DE CÓDIGOS:
- O widget interativo de códigos é injetado automaticamente pelo sistema logo após o primeiro parágrafo do post.
- NÃO escreva nenhuma lista de códigos, tabela de códigos, placeholder ou menção a "widget" dentro do updatedHtml. Os códigos vão SOMENTE nos campos data.activeCodes e data.expiredCodes.

COBERTURA MÁXIMA DE CÓDIGOS (obrigatório):
- Leia TODAS as fontes abaixo, em inglês e português, antes de montar data.activeCodes e data.expiredCodes.
- As fontes foram abertas com Tavily Extract advanced quando possível; procure códigos em tabelas, listas, botões, blocos de markdown e seções longas da página.
- Combine as listas de códigos de todas as fontes, sem parar nos primeiros resultados. Se uma fonte listar muitos códigos, capture todos os códigos visíveis naquela fonte.
- Para jogos com listas grandes, NÃO limite a 3-5 códigos. Se as fontes mostrarem 20, 30 ou mais códigos ativos, retorne todos os códigos válidos encontrados.
- Remova duplicados mantendo a grafia original do código. Se o mesmo código aparecer em mais de uma fonte, use uma das URLs onde ele aparece no campo "source".
- Códigos publicados no mês anterior continuam válidos no post do mês atual, a menos que a fonte diga claramente que expiraram. NÃO descarte por serem de {{prevMonthYear}}.
- Não descarte um código só porque ele aparece em apenas uma fonte; descarte apenas se ele não for do jogo correto, não for código de resgate ou não aparecer literalmente nas fontes.

REGRAS DOS CÓDIGOS (campos data.activeCodes/data.expiredCodes) — OBRIGATÓRIAS:
- Copie cada código EXATAMENTE como aparece nas fontes da busca web (caractere por caractere). NUNCA invente, adapte ou complete códigos.
- Cada código deve ter o campo "source" preenchido com a URL da fonte onde ele aparece.
- Aceite SOMENTE códigos de resgate do jogo "{{topic}}". Cupons de loja, códigos de desconto de e-commerce, promoções e códigos de outros jogos são PROIBIDOS.
- Se as fontes não confirmarem claramente que um código expirou, mantenha-o em activeCodes com isNew: false. Só mova para expiredCodes se a fonte disser explicitamente que não funciona mais. Data antiga, mês anterior ou ausência de menção ao mês atual NÃO significam expiração.
- Se as fontes não trouxerem NENHUM código válido para este jogo, defina noDataFound: true e deixe as listas vazias — mesmo assim produza o updatedHtml normal (introdução + como resgatar + onde encontrar novos códigos).

REGRAS DE HTML GUTENBERG (obrigatório em qualquer ação):
- Parágrafos: <!-- wp:paragraph --><p>texto</p><!-- /wp:paragraph -->
- Listas numeradas: <!-- wp:list {"ordered":true} --><ol><li>item</li></ol><!-- /wp:list -->
- Listas com marcador: <!-- wp:list --><ul><li>item</li></ul><!-- /wp:list -->
- Headings: <!-- wp:heading {"level":3} --><h3 class="wp-block-heading">título</h3><!-- /wp:heading -->
- NÃO coloque o título do post dentro do updatedHtml.
- NÃO escreva placeholders, reticências ou comentários no lugar de conteúdo real.
- NÃO use tags <script> ou <style>.

REGRAS DE SEO:
- Primeira frase do post deve conter o nome do jogo e a palavra "códigos".
- Tom direto, sem "Neste artigo vamos ver", sem enrolação.
- Linguagem informal, como um gamer escreveria.

FORMATO DA RESPOSTA (obrigatório):
- Responda exclusivamente com um objeto JSON válido, sem markdown, sem texto antes ou depois.

CAMPOS DA RESPOSTA:
- hasChanges: true se o post deve ser atualizado (quase sempre true, pois a data de atualização muda).
- newTitle: título com mês e ano atuais, ex: "Códigos {{topic}} ({{monthYear}}): lista completa".
- changesSummary: resumo em 1 linha — qual ação foi feita e o que mudou nos códigos.`;

const VERIFY_PROMPT_PT = `Você é um revisor rigoroso de códigos de resgate de jogos para o blog {{siteName}}.

JOGO: "{{topic}}"

REGRA DE RECÊNCIA: não reprove um código apenas porque a fonte é do mês anterior ou porque não menciona o mês atual. Se aparece literalmente nas fontes, é do jogo correto e não é cupom/promoção, aprove. Só trate como expirado quando a fonte disser explicitamente que expirou.

CÓDIGOS CANDIDATOS (extraídos por outro modelo — podem conter erros ou alucinações; o campo "list" indica a lista de origem):
{{candidatesJson}}

FONTES DA BUSCA WEB (conteúdo completo/raw_content das páginas; única base de verdade):
{{searchContext}}

TAREFA — para CADA código candidato, verifique:
1. O código aparece LITERALMENTE (caractere por caractere) em alguma das fontes acima?
2. A fonte onde ele aparece fala do jogo "{{topic}}" (e não de outro jogo)?
3. É um código de resgate dentro do jogo (e NÃO um cupom de loja, código de desconto de e-commerce ou promoção)?

Só aprove um código se as TRÊS respostas forem sim. Na dúvida, REPROVE.

FORMATO DA RESPOSTA (obrigatório):
- Responda exclusivamente com um objeto JSON válido, sem markdown, sem texto antes ou depois.

CAMPOS DA RESPOSTA:
- approved: array de objetos { "list": lista de origem do candidato (ex.: "activeCodes"), "value": o código exatamente como aparece nos candidatos }.
- rejected: cada código reprovado, com { "value", "reason" } (motivo em 1 frase).`;

const GENERATE_PROMPT_PT = `Você é um editor especialista de blog de games ({{siteName}}).
Hoje é {{today}}. Mês atual: {{monthYear}}.
Escreva um artigo NOVO sobre códigos do jogo "{{topic}}".

{{extraInstructions}}

RESULTADOS DA BUSCA WEB (conteúdo completo das páginas; única fonte permitida para códigos e fatos):
{{searchContext}}

ESTRUTURA DO ARTIGO (updatedHtml):
1. Parágrafo introdutório sobre o jogo (2-3 frases com a keyword principal, tom direto)
2. Como resgatar os códigos (passo a passo de 4-5 passos numerados)
3. Onde encontrar novos códigos (1 parágrafo)

Siga TODAS as regras de códigos, HTML Gutenberg e SEO abaixo:
- Códigos SOMENTE nos campos data.activeCodes/data.expiredCodes, copiados verbatim das fontes com "source" preenchido; NUNCA no HTML.
- Sem <script>/<style>, sem placeholders, sem o título dentro do HTML.
- Blocos Gutenberg: <!-- wp:paragraph -->, <!-- wp:list -->, <!-- wp:heading {"level":3} -->.
- Se não houver códigos válidos nas fontes, noDataFound: true e listas vazias.
- newTitle: título SEO com mês e ano atuais, ex: "Códigos {{topic}} ({{monthYear}}): lista completa".
- hasChanges: sempre true.
- changesSummary: resumo em 1 linha do artigo criado.

FORMATO DA RESPOSTA: exclusivamente um objeto JSON válido, sem markdown.`;

const UPDATE_PROMPT_EN = `You are an expert games blog editor ({{siteName}}).
Today is {{today}}.
Current month for this post: {{monthYear}}. Previous month also considered for still-valid codes: {{prevMonthYear}}.
The post is about codes for the game "{{topic}}".

CURRENT POST CONTENT (Gutenberg HTML; the codes widget was already removed and is managed automatically by the system):
{{currentHtml}}

WEB SEARCH RESULTS (full page content/raw_content; the ONLY allowed source for codes):
{{searchContext}}

MAIN TASK:
Ensure editorial quality and correct codes. Evaluate the current post and choose ONE action (field "action"):

ACTION "update" — post is good, needs only adjustments:
- Use when the post already has a proper structure and coherent text.
- Only refresh the "Last updated:" date if present and keep the rest of updatedHtml nearly intact.

ACTION "reorganize" — post has useful but poorly structured content:
- Rewrite updatedHtml reorganizing into: 1. intro paragraph (2-3 sentences, SEO), 2. how to redeem codes (short numbered steps), 3. where to find new codes (1 paragraph).

ACTION "rewrite" — post is empty, incoherent or very poor:
- Create a complete updatedHtml from scratch with the same three sections (intro with main keyword, 4-5 numbered redeem steps, where to find new codes mentioning official social media and reference sites).

ABOUT THE CODES WIDGET:
- The interactive codes widget is injected automatically right after the first paragraph.
- Do NOT write any code list, code table, placeholder or mention of "widget" inside updatedHtml. Codes go ONLY in data.activeCodes and data.expiredCodes.

MAXIMUM CODE COVERAGE (mandatory):
- Read ALL sources below (all languages) before building data.activeCodes and data.expiredCodes.
- Look for codes in tables, lists, buttons, markdown blocks and long page sections; combine code lists from all sources without stopping at the first results.
- Do NOT cap the list at 3-5 codes — if sources show 20 or 30 active codes, return all valid ones.
- Remove duplicates keeping the original spelling. If the same code appears in multiple sources, use one of those URLs in "source".
- Codes published last month remain valid this month unless a source clearly says they expired. Do NOT discard codes just for being from {{prevMonthYear}}.
- Do not discard a code for appearing in only one source; discard only if it is for the wrong game, not an in-game redeem code, or does not appear literally in the sources.

CODE RULES (data.activeCodes/data.expiredCodes fields) — MANDATORY:
- Copy each code EXACTLY as it appears in the web sources (character by character). NEVER invent, adapt or complete codes.
- Every code must have "source" filled with the URL where it appears.
- Accept ONLY in-game redeem codes for "{{topic}}". Store coupons, e-commerce discount codes, promotions and codes for other games are FORBIDDEN.
- If sources do not clearly confirm a code expired, keep it in activeCodes with isNew: false. Only move to expiredCodes when a source explicitly says it no longer works.
- If sources bring NO valid code for this game, set noDataFound: true and leave the lists empty — still produce the normal updatedHtml.

GUTENBERG HTML RULES (mandatory for any action):
- Paragraphs: <!-- wp:paragraph --><p>text</p><!-- /wp:paragraph -->
- Numbered lists: <!-- wp:list {"ordered":true} --><ol><li>item</li></ol><!-- /wp:list -->
- Bullet lists: <!-- wp:list --><ul><li>item</li></ul><!-- /wp:list -->
- Headings: <!-- wp:heading {"level":3} --><h3 class="wp-block-heading">title</h3><!-- /wp:heading -->
- Do NOT put the post title inside updatedHtml. No placeholders, no <script> or <style> tags.

SEO RULES:
- First sentence must contain the game name and the word "codes".
- Direct tone, no filler like "In this article we will see".

RESPONSE FORMAT (mandatory): respond exclusively with a valid JSON object, no markdown, no text before or after.

RESPONSE FIELDS:
- hasChanges: true if the post should be updated (almost always true, since the update date changes).
- newTitle: title with current month and year, e.g. "{{topic}} Codes ({{monthYear}}): full list".
- changesSummary: 1-line summary — which action was taken and what changed in the codes.`;

const VERIFY_PROMPT_EN = `You are a rigorous reviewer of game redeem codes for the blog {{siteName}}.

GAME: "{{topic}}"

RECENCY RULE: do not reject a code just because the source is from last month or does not mention the current month. If it appears literally in the sources, is for the correct game and is not a coupon/promotion, approve it. Only treat as expired when a source explicitly says so.

CANDIDATE CODES (extracted by another model — may contain errors or hallucinations; "list" indicates the source list):
{{candidatesJson}}

WEB SOURCES (full page content; the only ground truth):
{{searchContext}}

TASK — for EACH candidate code, check:
1. Does the code appear LITERALLY (character by character) in any source above?
2. Does that source talk about the game "{{topic}}" (not another game)?
3. Is it an in-game redeem code (NOT a store coupon, e-commerce discount or promotion)?

Only approve a code if ALL THREE answers are yes. When in doubt, REJECT.

RESPONSE FORMAT (mandatory): respond exclusively with a valid JSON object, no markdown.

RESPONSE FIELDS:
- approved: array of objects { "list": candidate source list (e.g. "activeCodes"), "value": the code exactly as in the candidates }.
- rejected: each rejected code, with { "value", "reason" } (1-sentence reason).`;

const GENERATE_PROMPT_EN = `You are an expert games blog editor ({{siteName}}).
Today is {{today}}. Current month: {{monthYear}}.
Write a NEW article about codes for the game "{{topic}}".

{{extraInstructions}}

WEB SEARCH RESULTS (full page content; the ONLY allowed source for codes and facts):
{{searchContext}}

ARTICLE STRUCTURE (updatedHtml):
1. Intro paragraph about the game (2-3 sentences with the main keyword, direct tone)
2. How to redeem codes (4-5 numbered steps)
3. Where to find new codes (1 paragraph)

Follow ALL the code, Gutenberg HTML and SEO rules:
- Codes ONLY in data.activeCodes/data.expiredCodes, copied verbatim from sources with "source" filled; NEVER in the HTML.
- No <script>/<style>, no placeholders, no title inside the HTML.
- Gutenberg blocks: <!-- wp:paragraph -->, <!-- wp:list -->, <!-- wp:heading {"level":3} -->.
- If there are no valid codes in the sources, noDataFound: true and empty lists.
- newTitle: SEO title with current month and year, e.g. "{{topic}} Codes ({{monthYear}}): full list".
- hasChanges: always true. changesSummary: 1-line summary.

RESPONSE FORMAT: exclusively a valid JSON object, no markdown.`;

export const gameCodesTemplate = {
  slug: 'game-codes',
  name: 'Códigos de jogos',
  description:
    'Mantém posts de códigos de resgate atualizados: busca fontes em 2 idiomas, extrai códigos com verificação anti-alucinação em 3 camadas e injeta um widget interativo de códigos.',
  config: {
    defaultLanguage: 'pt-BR',
    topic: {
      stripPatterns: ['códigos?', 'codes?'],
      cutAt: ['(', ':', '-'],
    },
    queries: [
      { name: 'en-current', locale: 'en-US', template: '"{{topic}}" codes active working latest {{monthYear}}' },
      { name: 'pt-current', locale: 'pt-BR', template: '"{{topic}}" códigos ativos funcionando atualizados {{monthYear}}' },
      { name: 'en-previous', locale: 'en-US', template: '"{{topic}}" all codes active working {{prevMonthYear}} {{monthYear}}' },
      { name: 'pt-previous', locale: 'pt-BR', template: '"{{topic}}" todos os códigos ativos funcionando {{prevMonthYear}} {{monthYear}}' },
    ],
    sources: {
      blocklist: [
        'youtube.com', 'youtu.be', 'tiktok.com', 'instagram.com', 'facebook.com', 'twitter.com', 'x.com', 'reddit.com',
        'cuponomia.com', 'pelando.com', 'promobit.com', 'retailmenot.com', 'coupert.com', 'joinhoney.com',
        'picodi.com', 'cuponation', 'groupon.com', 'meliuz.com', 'cupom.com',
      ],
      trustlist: [
        'progameguides.com', 'tryhardguides.com', 'pockettactics.com', 'beebom.com', 'dexerto.com',
        'gamerant.com', 'pcgamesn.com', 'sportskeeda.com', 'robloxden.com', 'gamesradar.com', 'videogamer.com',
        'gamezebo.com', 'destructoid.com', 'dotesports.com', 'thegamer.com', 'gfinityesports.com',
        'siliconera.com', 'escapistmagazine.com', 'rockpapershotgun.com', 'oneesports.gg',
        'criticalhits.com.br', 'flowgames.gg', 'gamearena.gg', 'mobilegamer.com.br', 'meups.com.br',
        'tecmundo.com.br', 'tudocelular.com', 'manualdosgames.com', 'nerdlicious.com.br', 'ligadosgames.com',
        'maisesports.com.br', 'olhardigital.com.br',
      ],
      sourceLimit: 20,
      perQueryQuota: 6,
      perSourceCharLimit: 30_000,
      contextCharLimit: 180_000,
    },
    prompts: {
      'pt-BR': {
        update: UPDATE_PROMPT_PT,
        verify: VERIFY_PROMPT_PT,
        generate: GENERATE_PROMPT_PT,
      },
      'en-US': {
        update: UPDATE_PROMPT_EN,
        verify: VERIFY_PROMPT_EN,
        generate: GENERATE_PROMPT_EN,
      },
    },
    extraction: {
      enabled: true,
      dataSchema: {
        type: 'object',
        properties: {
          activeCodes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                reward: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                isNew: { type: 'boolean' },
                source: { type: 'string' },
              },
              required: ['code', 'reward', 'isNew', 'source'],
              additionalProperties: false,
            },
          },
          expiredCodes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                reward: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                source: { type: 'string' },
              },
              required: ['code', 'reward', 'source'],
              additionalProperties: false,
            },
          },
        },
        required: ['activeCodes', 'expiredCodes'],
        additionalProperties: false,
      },
      verbatimLists: [
        { path: 'activeCodes', valueField: 'code' },
        { path: 'expiredCodes', valueField: 'code' },
      ],
      valuePattern: '^[A-Za-z0-9!?_@#.\\-]{2,40}$',
      minSourcesForEmptyClaim: 3,
    },
    managedBlock: {
      enabled: true,
      markerPrefix: 'DG-CODES-WIDGET',
      rendererId: 'game-codes-widget',
      legacySignatures: ['dg-codes-widget'],
    },
    validation: { titleMin: 10, titleMax: 120, htmlMinChars: 200 },
    llmDefaults: { generateMaxTokens: 16_000, generateTemperature: 0.2, verifyMaxTokens: 8_000, verifyTemperature: 0 },
  } satisfies TemplateConfig,
};
