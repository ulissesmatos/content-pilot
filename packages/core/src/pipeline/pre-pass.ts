/**
 * Pré-checagem determinística (modo econômico): decide SEM IA se as fontes
 * trazem novidade em relação aos dados já publicados no post.
 *
 * Dois sinais disparam a chamada de IA:
 *  - `missing`: um valor já publicado (ex.: código ativo) sumiu das fontes —
 *    provável expiração;
 *  - `newCandidates`: tokens com cara de código aparecem perto de palavras-chave
 *    ("codes", "códigos", "redeem"...) e não estão na lista publicada.
 *
 * Falso positivo custa apenas uma chamada de IA (comportamento antigo);
 * falso negativo custa pular uma atualização — por isso os filtros são
 * calibrados para sensibilidade.
 */

export interface PrePassInput {
  searchContext: string;
  /** Valores já publicados (todas as listas verbatim: ativos + expirados). */
  lastValues: string[];
  /** Valores da(s) lista(s) principal(is) (ativos) — usados no sinal `missing`. */
  lastActiveValues: string[];
  valuePattern: string;
  keywords?: string[];
  /** Janela (chars) ao redor de cada keyword onde procuramos tokens novos. */
  keywordWindowChars?: number;
}

export interface PrePassResult {
  changed: boolean;
  missing: string[];
  newCandidates: string[];
}

export const DEFAULT_PREPASS_KEYWORDS = [
  'code',
  'codes',
  'código',
  'códigos',
  'codigo',
  'codigos',
  'redeem',
  'resgatar',
  'resgate',
  'expired',
  'expirado',
  'expirados',
  'working',
  'ativo',
  'ativos',
];

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, '');

/**
 * Palavras comuns em manchetes/estrutura das fontes que parecem código quando
 * em CAIXA ALTA ("ALL WORKING CODES JULY"). Falso positivo aqui só custa uma
 * chamada de IA, então a lista não precisa ser exaustiva.
 */
const TOKEN_STOPWORDS = new Set(
  [
    'fonte', 'consultas', 'search', 'extract', 'content', 'raw_content', 'https', 'http',
    'code', 'codes', 'codigo', 'codigos', 'coupon', 'cupom', 'promo',
    'roblox', 'update', 'updated', 'atualizado', 'atualizados', 'working',
    'active', 'actives', 'ativo', 'ativos', 'expired', 'expirado', 'expirados',
    'redeem', 'resgatar', 'resgate', 'reward', 'rewards', 'lista', 'list',
    'full', 'wiki', 'guide', 'guia', 'new', 'free', 'latest', 'month',
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
    'september', 'october', 'november', 'december',
    'janeiro', 'fevereiro', 'marco', 'março', 'abril', 'maio', 'junho', 'julho',
    'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ],
);

function tokenLooksLikeCode(token: string): boolean {
  if (token.length < 4 || token.length > 40) return false;
  // domínio/URL/arquivo não é código
  if (/^https?/i.test(token)) return false;
  if (/\.(com|net|org|br|gg|io|co|dev|app|html?|php|png|jpe?g|webp)$/i.test(token)) return false;
  if (/\.[a-z]{2,4}\./i.test(token)) return false;
  // ano/número puro curto não é código
  if (/^\d{1,4}$/.test(token)) return false;
  if (TOKEN_STOPWORDS.has(token.toLowerCase())) return false;

  const hasDigit = /\d/.test(token);
  const hasSymbol = /[!?_@#]/.test(token);
  if (hasDigit || hasSymbol) return true;
  // camelCase interno (Sub2Xeno sem dígito: maiúscula DEPOIS do 1º char + minúsculas)
  if (/[a-z]/.test(token) && /[A-Z]/.test(token.slice(1))) return true;
  // ALL-CAPS longo (OKUCHI) — Titlecase comum ("Guia") fica de fora
  if (token.length >= 5 && /^[A-Z][A-Z0-9!?_@#.\-]*$/.test(token) && !/[a-z]/.test(token)) return true;
  return false;
}

/** Extrai o corpo do valuePattern do template ("^…$" → "…") para uso global. */
function tokenRegexFrom(valuePattern: string): RegExp {
  const body = valuePattern.replace(/^\^/, '').replace(/\$$/, '');
  try {
    return new RegExp(body.replace(/\{[\d,]+\}/, '+'), 'g');
  } catch {
    return /[A-Za-z0-9!?_@#.\-]+/g;
  }
}

export function prePassCheck(input: PrePassInput): PrePassResult {
  const keywords = input.keywords?.length ? input.keywords : DEFAULT_PREPASS_KEYWORDS;
  const windowChars = input.keywordWindowChars ?? 300;
  const contextNorm = normalize(input.searchContext);
  const lastValuesNorm = new Set(input.lastValues.map(normalize));

  // Sinal 1: valor ativo publicado que não aparece mais em nenhuma fonte
  const missing = input.lastActiveValues.filter((v) => v.trim() && !contextNorm.includes(normalize(v)));

  // Sinal 2: tokens code-like perto de keywords que não estão publicados
  const lower = input.searchContext.toLowerCase();
  const tokenRe = tokenRegexFrom(input.valuePattern);
  const candidates = new Set<string>();

  for (const kw of keywords) {
    let from = 0;
    for (let guard = 0; guard < 500; guard++) {
      const idx = lower.indexOf(kw, from);
      if (idx === -1) break;
      from = idx + kw.length;
      const start = Math.max(0, idx - windowChars);
      const end = Math.min(input.searchContext.length, idx + kw.length + windowChars);
      const window = input.searchContext.slice(start, end);
      for (const match of window.matchAll(tokenRe)) {
        const token = match[0];
        if (!tokenLooksLikeCode(token)) continue;
        if (lastValuesNorm.has(normalize(token))) continue;
        // keywords em caixa alta/baixa não são códigos
        if (keywords.includes(token.toLowerCase())) continue;
        candidates.add(token);
        if (candidates.size >= 200) break;
      }
      if (candidates.size >= 200) break;
    }
  }

  const newCandidates = Array.from(candidates);
  return {
    changed: missing.length > 0 || newCandidates.length > 0,
    missing,
    newCandidates,
  };
}

/**
 * Contexto enxuto para a chamada de IA do modo econômico: em vez dos 180k
 * chars completos, só as janelas ao redor dos tokens relevantes (novos
 * candidatos + publicados, para o LLM confirmar expiração) + o cabeçalho de
 * cada fonte. A checagem verbatim (camada 3) roda contra este mesmo texto.
 */
export function buildTrimmedContext(
  fullContext: string,
  tokens: string[],
  opts: { windowChars?: number; maxChars?: number } = {},
): string {
  const windowChars = opts.windowChars ?? 350;
  const maxChars = opts.maxChars ?? 40_000;
  const lower = fullContext.toLowerCase();

  // Cabeçalhos "FONTE n [...]" + linha do título/URL mantêm a rastreabilidade
  const headers: string[] = [];
  for (const m of fullContext.matchAll(/FONTE \d+ \[[^\]]*\]\n\[[^\n]*\n?/g)) {
    headers.push(m[0].trim());
  }

  const ranges: Array<[number, number]> = [];
  for (const token of tokens) {
    const needle = token.toLowerCase();
    if (!needle.trim()) continue;
    let from = 0;
    for (let occurrence = 0; occurrence < 3; occurrence++) {
      const idx = lower.indexOf(needle, from);
      if (idx === -1) break;
      from = idx + needle.length;
      ranges.push([Math.max(0, idx - windowChars), Math.min(fullContext.length, idx + needle.length + windowChars)]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);

  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r] as [number, number]);
  }

  let out =
    'CONTEXTO REDUZIDO (modo econômico): trechos das fontes ao redor dos códigos detectados.\n\nFONTES:\n' +
    headers.join('\n') +
    '\n\n---\n\n';
  for (const [start, end] of merged) {
    const excerpt = fullContext.slice(start, end).trim();
    if (out.length + excerpt.length + 8 > maxChars) break;
    out += '…' + excerpt + '…\n\n';
  }
  return out.slice(0, maxChars);
}
