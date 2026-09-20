import type { EmbedItem } from '../embeds/parse';
import type { ReviewChange, ReviewResult } from './review';

/**
 * O que a etapa editorial e a busca de embeds fizeram no artigo, gravado junto da
 * pauta para a tela de preview. O HTML não diz isto: uma frase reescrita ou um
 * tweet que entrou parecem texto comum depois de publicados.
 */
export interface EditorialReport {
  review: {
    status: ReviewResult['status'];
    changes: ReviewChange[];
    /** Por que a revisão foi descartada, quando foi. */
    reason: string | null;
    /** Vícios de IA que sobraram no texto final. */
    remainingTells: string[];
  } | null;
  embeds: EmbedItem[];
  embedNotes: string[];
}

/** Todos os resultados possíveis da revisão; a tela precisa de um texto para cada um. */
export const REVIEW_STATUSES = ['revised', 'unchanged', 'rejected', 'failed', 'budget_exceeded'] as const satisfies readonly ReviewResult['status'][];
const REVIEW_STATUS_SET: ReadonlySet<string> = new Set(REVIEW_STATUSES);
const CHANGE_KINDS = new Set(['dull', 'thin', 'ai_tone', 'other']);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Lê o relatório do banco (jsonb) sem confiar no formato: descarta o que vier torto. */
export function parseEditorialReport(value: unknown): EditorialReport | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;

  let review: EditorialReport['review'] = null;
  const r = v.review;
  if (r && typeof r === 'object') {
    const rr = r as Record<string, unknown>;
    if (typeof rr.status === 'string' && REVIEW_STATUS_SET.has(rr.status)) {
      review = {
        status: rr.status as ReviewResult['status'],
        changes: (Array.isArray(rr.changes) ? rr.changes : [])
          .filter(
            (c): c is ReviewChange =>
              !!c && typeof c === 'object' && typeof (c as ReviewChange).note === 'string' && CHANGE_KINDS.has((c as ReviewChange).kind),
          )
          .map((c) => ({ kind: c.kind, section: typeof c.section === 'string' ? c.section : '', note: c.note })),
        reason: typeof rr.reason === 'string' ? rr.reason : null,
        remainingTells: strings(rr.remainingTells),
      };
    }
  }

  const embeds = (Array.isArray(v.embeds) ? v.embeds : []).filter(
    (e): e is EmbedItem =>
      !!e &&
      typeof e === 'object' &&
      ((e as EmbedItem).kind === 'youtube' || (e as EmbedItem).kind === 'tweet') &&
      typeof (e as EmbedItem).url === 'string',
  );
  return { review, embeds, embedNotes: strings(v.embedNotes) };
}
