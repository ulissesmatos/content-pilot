/**
 * Guarda de estilo determinística para o texto que o LLM devolve.
 *
 * Existe porque regra de prompt não é garantia: modelos escrevem travessão e
 * enfiam data no título mesmo quando mandados não fazer. A instrução no prompt
 * reduz a ocorrência, e este módulo conserta o que sobrar antes de publicar.
 *
 * Tudo aqui é conservador de propósito: na dúvida, não mexe. Um travessão
 * sobrando é melhor que uma frase quebrada, e um título com data é melhor que
 * um título mutilado.
 */

export interface DashRewrite {
  text: string;
  /** Quantos travessões foram reescritos. */
  count: number;
}

// U+2014 (em dash), U+2013 (en dash), U+2015 (barra horizontal), U+2E3A/3B (dois/três-em).
const DASH = '[\\u2014\\u2013\\u2015\\u2E3A\\u2E3B]';
const DASH_ENTITY = /&(?:mdash|ndash|horbar);|&#(?:8212|8211|8213);|&#x(?:2014|2013|2015);/gi;

/** Trechos onde o texto é literal e nunca deve ser reescrito. */
const RAW_TEXT_TAGS = new Set(['code', 'pre', 'script', 'style', 'kbd', 'samp', 'textarea']);

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/**
 * Palavras que continuam a frase em vez de abrir uma explicação. Depois de
 * "Foi rápido — e barato" os dois-pontos ficam errados; ali é vírgula.
 */
const CONTINUATION_WORDS = new Set([
  'e', 'mas', 'ou', 'porém', 'porem', 'contudo', 'todavia', 'porque', 'pois', 'que', 'se', 'quando',
  'nem', 'então', 'entao', 'também', 'tambem', 'só', 'apenas', 'até', 'ate', 'onde', 'como', 'já', 'ja',
  'and', 'but', 'or', 'so', 'because', 'which', 'that', 'when', 'while', 'then', 'yet', 'nor', 'if',
]);

const firstWord = (s: string) => (/^[^\p{L}\p{N}]*([\p{L}\p{N}]+)/u.exec(s.trimStart())?.[1] ?? '').toLowerCase();

/**
 * Reescreve travessões num trecho de TEXTO (sem HTML).
 *
 * Escolha do substituto, na ordem:
 *  - travessão no começo ou no fim da frase é marca de fala: some;
 *  - dois travessões na mesma frase são um aposto, viram vírgulas;
 *  - um travessão sozinho depois de um rótulo curto (até 3 palavras) introduz
 *    uma explicação: vira dois-pontos;
 *  - o resto vira vírgula.
 *
 * `title` força dois-pontos no primeiro travessão, que é como título se escreve.
 */
export function rewriteDashesInText(input: string, opts: { title?: boolean } = {}): DashRewrite {
  let text = input.replace(DASH_ENTITY, '—');
  let count = 0;

  // Faixa numérica ou de datas ("2020–2023", "10–15") é tipografia correta,
  // não tique de IA: vira hífen para não sobrar nenhum travessão.
  text = text.replace(new RegExp(`(?<=\\d)\\s?${DASH}\\s?(?=\\d)`, 'gu'), () => {
    count++;
    return '-';
  });
  // Composto sem espaço ("Xbox–PC"): hífen.
  text = text.replace(new RegExp(`(?<=\\p{L})${DASH}(?=\\p{L})`, 'gu'), () => {
    count++;
    return '-';
  });
  // O hífen ASCII espaçado entre letras é o mesmo tique com outra roupa.
  // Só entre letras: "10 - 20" e listas numeradas ficam como estão.
  text = text.replace(/(?<=\p{L}) - (?=\p{L})/gu, ' — ');

  if (!new RegExp(DASH, 'u').test(text)) return { text, count };

  // Trabalha frase a frase para decidir aposto x dash isolado.
  const parts = text.split(/(?<=[.!?…])\s+(?=\S)/u);
  const rewritten = parts.map((sentence) => {
    const dashes = sentence.match(new RegExp(DASH, 'gu'))?.length ?? 0;
    if (dashes === 0) return sentence;

    let seen = 0;
    return sentence.replace(new RegExp(`\\s*${DASH}\\s*`, 'gu'), (match: string, offset: number) => {
      seen++;
      count++;
      const before = sentence.slice(0, offset);
      const after = sentence.slice(offset + match.length);

      // Começo ou fim da frase: só some.
      if (before.trim() === '' || after.trim() === '') return '';

      // Pontuação que já existia antes do dash: não duplica.
      if (/[,;:]$/.test(before.trimEnd())) return ' ';

      if (opts.title) return seen === 1 ? ': ' : ', ';
      if (
        dashes === 1 &&
        wordCount(before) <= 3 &&
        wordCount(after) >= 3 &&
        !CONTINUATION_WORDS.has(firstWord(after))
      ) {
        return ': ';
      }
      return ', ';
    });
  });

  return { text: rewritten.join(' ').replace(/ {2,}/g, ' '), count };
}

/**
 * Reescreve travessões num fragmento de HTML, tocando só nos nós de texto.
 * Atributos, comentários (o JSON dos blocos do Gutenberg), URLs e o conteúdo de
 * code, pre, script e style ficam intactos.
 */
export function rewriteDashesInHtml(html: string): DashRewrite {
  if (!html) return { text: html, count: 0 };
  const tokens = html.split(/(<!--[\s\S]*?-->|<[^>]+>)/g);
  let total = 0;
  const rawStack: string[] = [];

  const out = tokens.map((token) => {
    if (token.startsWith('<!--')) return token;
    if (token.startsWith('<')) {
      const m = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(token);
      if (m) {
        const tag = m[2]!.toLowerCase();
        const closing = m[1] === '/';
        if (RAW_TEXT_TAGS.has(tag)) {
          if (closing) {
            const i = rawStack.lastIndexOf(tag);
            if (i >= 0) rawStack.splice(i, 1);
          } else if (!token.endsWith('/>')) {
            rawStack.push(tag);
          }
        }
      }
      return token;
    }
    if (rawStack.length > 0 || token === '') return token;
    const r = rewriteDashesInText(token);
    total += r.count;
    return r.text;
  });

  return { text: out.join(''), count: total };
}

const MONTHS_PT = 'janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro';
const MONTHS_EN = 'january|february|march|april|may|june|july|august|september|october|november|december';
const MONTHS_ABBR = 'jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez|feb|apr|aug|sep|oct|dec';
const MONTH = `(?:${MONTHS_PT}|${MONTHS_EN}|${MONTHS_ABBR})\\.?`;
const NUMERIC_DATE = '(?:\\d{1,2}[/.\\-]\\d{1,2}[/.\\-]\\d{2,4}|\\d{4}[/.\\-]\\d{1,2}[/.\\-]\\d{1,2})';
const LONG_DATE = `(?:\\d{1,2}\\s+(?:de\\s+)?)?${MONTH}(?:\\s+(?:de\\s+)?\\d{4})?`;
const ANY_DATE = `(?:${NUMERIC_DATE}|${LONG_DATE}|\\d{4})`;

/**
 * Tira a data DECORATIVA do título: "(20/09/2026)", "- setembro de 2026",
 * "em setembro de 2026" no fim. Ano solto no meio ("Melhores jogos de 2026")
 * fica, porque ali ele faz parte do assunto.
 *
 * Devolve o título original quando a limpeza o deixaria curto demais: um título
 * com data é melhor que um título mutilado.
 */
export function stripDecorativeDates(
  title: string,
  opts: { minLength?: number } = {},
): { title: string; removed: boolean } {
  const minLength = opts.minLength ?? 10;
  let t = title;

  // 1. Entre parênteses ou colchetes, em qualquer posição.
  t = t.replace(new RegExp(`\\s*[\\(\\[]\\s*${ANY_DATE}\\s*[\\)\\]]`, 'giu'), '');
  // 2. Depois de separador, no fim: "- setembro de 2026", "| 20/09/2026".
  t = t.replace(
    new RegExp(`\\s*[-\\u2013\\u2014|:]\\s*(?:atualizado\\s+(?:em|at[eé])\\s+)?${ANY_DATE}\\s*$`, 'iu'),
    '',
  );
  // 3. Data preposicionada no fim: "em setembro de 2026", "para 20/09/2026".
  t = t.replace(
    new RegExp(
      `\\s+(?:em|de|para|no dia|do dia|hoje,?|atualizado em)\\s+(?:${NUMERIC_DATE}|${MONTH}\\s+(?:de\\s+)?\\d{4}|\\d{1,2}\\s+de\\s+${MONTH}(?:\\s+de\\s+\\d{4})?)\\s*$`,
      'iu',
    ),
    '',
  );
  // 4. Data numérica solta no meio ("... em 20/09/2026: ...").
  t = t.replace(new RegExp(`\\s+(?:(?:em|de|no dia|do dia)\\s+)?${NUMERIC_DATE}`, 'giu'), '');

  // Limpeza do que a remoção deixou: espaços, pontuação órfã, ":" colado.
  t = t
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([:;,.!?])/g, '$1')
    .replace(/([:;,])\s*([:;,])/g, '$1')
    .replace(/[\s\-–—|:,;]+$/u, '')
    .replace(/^[\s\-–—|:,;]+/u, '')
    .trim();

  if (t === title.trim() || t.length < minLength) return { title, removed: false };
  return { title: t, removed: true };
}

export type DatePolicy = 'avoid' | 'allow';

export interface StylePolicy {
  /** Reescrever travessões no texto gerado. */
  noDashes: boolean;
  /** 'avoid' tira data decorativa do título e instrui o modelo a evitá-la. */
  datePolicy: DatePolicy;
}

export interface StyleGuardResult {
  title: string;
  html: string;
  metaDescription: string;
  dashesRewritten: number;
  titleDateRemoved: boolean;
}

/** Aplica a política ao que o LLM devolveu. Nunca lança: falha vira "sem mudança". */
export function applyStyleGuard(
  input: { title: string; html: string; metaDescription?: string },
  policy: StylePolicy,
  opts: { titleMinLength?: number } = {},
): StyleGuardResult {
  let title = input.title;
  let html = input.html;
  let meta = input.metaDescription ?? '';
  let dashesRewritten = 0;
  let titleDateRemoved = false;

  try {
    if (policy.datePolicy === 'avoid') {
      const r = stripDecorativeDates(title, { minLength: opts.titleMinLength });
      title = r.title;
      titleDateRemoved = r.removed;
    }
    if (policy.noDashes) {
      const t = rewriteDashesInText(title, { title: true });
      title = t.text;
      const h = rewriteDashesInHtml(html);
      html = h.text;
      const m = rewriteDashesInText(meta);
      meta = m.text;
      dashesRewritten = t.count + h.count + m.count;
    }
  } catch {
    return {
      title: input.title,
      html: input.html,
      metaDescription: input.metaDescription ?? '',
      dashesRewritten: 0,
      titleDateRemoved: false,
    };
  }

  return { title, html, metaDescription: meta, dashesRewritten, titleDateRemoved };
}

/**
 * Instrução de estilo anexada ao prompt em runtime, e não gravada em cada
 * template: templates clonados por clientes guardam o próprio prompt no banco,
 * então só uma instrução injetada aqui alcança todos sem migração.
 */
export function buildStyleInstructions(policy: StylePolicy, language: string): string {
  const pt = language.toLowerCase().startsWith('pt');
  const lines: string[] = [];

  if (policy.noDashes) {
    lines.push(
      pt
        ? 'NUNCA use travessão (— ou –) nem hífen com espaços (" - ") como pontuação. Reescreva com vírgula, ponto final, dois-pontos ou parênteses. Hífen dentro de palavra composta é permitido.'
        : 'NEVER use em dashes or en dashes (— or –), nor spaced hyphens (" - "), as punctuation. Rewrite with a comma, period, colon or parentheses. Hyphens inside compound words are fine.',
    );
  }
  if (policy.datePolicy === 'avoid') {
    lines.push(
      pt
        ? 'NÃO coloque data, dia, mês ou ano no título nem espalhados pelo texto. Só cite uma data quando o fato depender dela (data de lançamento, prazo de um evento). Nada de "atualizado em", "(20/09/2026)" ou "em setembro de 2026" por hábito.'
        : 'Do NOT put dates, days, months or years in the title or scattered through the text. Only cite a date when the fact depends on it (a release date, an event deadline). No "updated on", "(09/20/2026)" or "in September 2026" out of habit.',
    );
  }
  if (lines.length === 0) return '';

  return pt
    ? `\n\nREGRAS DE ESTILO (têm prioridade sobre qualquer instrução anterior):\n${lines.map((l) => `- ${l}`).join('\n')}`
    : `\n\nSTYLE RULES (these override any earlier instruction):\n${lines.map((l) => `- ${l}`).join('\n')}`;
}

export const LANGUAGE_NAMES: Record<string, string> = {
  'pt-BR': 'português do Brasil (pt-BR)',
  pt: 'português (pt)',
  'en-US': 'English (en-US)',
  en: 'English (en)',
  'es-ES': 'español de España (es-ES)',
  es: 'español (es)',
};

/**
 * Instrução de idioma anexada em runtime, igual às regras de estilo acima.
 *
 * Necessária porque o template pode não ter um prompt traduzido pro idioma
 * pedido: `promptsForLanguage` cai no `defaultLanguage` do template nesse
 * caso, e sem esta instrução explícita o texto sairia no idioma do prompt
 * (normalmente pt-BR), não no idioma que o autopilot/job pediu.
 *
 * Bilíngue de propósito: a mesma instrução escrita em português E no idioma
 * alvo garante que o modelo a entenda não importa qual idioma ele "prefira"
 * internamente ao processar o resto do prompt.
 */
export function buildLanguageInstruction(language: string): string {
  const name = LANGUAGE_NAMES[language] ?? language;
  return `\n\nIDIOMA OBRIGATÓRIO / REQUIRED LANGUAGE: escreva TODO o conteúdo (título, corpo do artigo, meta descrição, resumo) em ${name}. Write the ENTIRE output (title, article body, meta description, summary) in ${name}. Mesmo que as fontes de pesquisa estejam em outro idioma, traduza as informações relevantes — even if the research sources are in another language, translate the relevant information. Never mix languages in the output.`;
}
