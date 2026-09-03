/**
 * Redação de valores sensíveis antes de gravar na auditoria.
 *
 * A trilha de auditoria registra o que mudou em cada ação administrativa —
 * inclusive em ações que trocam chaves de API. Sem esta camada, o segredo
 * sairia do cofre cifrado e cairia em texto claro numa coluna jsonb comum.
 *
 * Vive no core (puro) para poder ser testado: é o tipo de código que só
 * falha em produção, e em silêncio.
 */

/** Nome de campo que denuncia conteúdo secreto. */
const SECRET_KEY_RE = /(secret|password|passwd|token|api[-_]?key|private|ciphertext|credential)/i;

/**
 * Campos que casam com o padrão acima mas são identificadores públicos —
 * mantê-los é o que torna a auditoria útil (dá para rastrear QUAL objeto
 * mudou sem revelar o valor).
 */
const NOT_SECRET = new Set([
  'keyId',
  'key_id',
  'maskedHint',
  'masked_hint',
  'credentialId',
  'credential_id',
  'stripePriceId',
  'stripe_price_id',
  'stripeCustomerId',
  'stripe_customer_id',
  'stripeSubscriptionId',
  'stripe_subscription_id',
]);

export const REDACTED = '***';

const MAX_DEPTH = 6;
const MAX_ARRAY = 50;
const MAX_STRING = 500;

export function isSecretField(name: string): boolean {
  return !NOT_SECRET.has(name) && SECRET_KEY_RE.test(name);
}

/**
 * Devolve uma cópia com todo campo sensível substituído por `***`, arrays e
 * strings truncados e profundidade limitada — uma estrutura vinda do cliente
 * não pode inflar a tabela nem estourar a pilha.
 */
export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[aninhado demais]';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY).map((v) => redactSecrets(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = isSecretField(key) ? REDACTED : redactSecrets(inner, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > MAX_STRING) {
    return `${value.slice(0, MAX_STRING)}…`;
  }
  return value;
}
