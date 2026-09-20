import { planInlineInsertions } from '../html/inline-images';
import { stripDiacritics } from '../i18n/slug';
import type { ImageSize } from './generate';

/** Dica do revisor sobre onde uma imagem ajuda. Tipo próprio para o módulo de imagens não depender do de revisão. */
export interface SlotHint {
  afterHeading: string | null;
  description: string;
}

/**
 * Planejamento de imagens de um artigo.
 *
 * Antes, o artigo inteiro tinha UMA busca de duas palavras-chave e uma única
 * chamada de visão escolhia capa e imagens do corpo de um pool comum. Resultado:
 * a imagem do meio raramente combinava com o trecho onde caía.
 *
 * Aqui cada imagem é um SLOT com o que deve mostrar (título da seção e o
 * parágrafo em volta), a consulta de busca própria e o tamanho final. Tudo
 * determinístico: o que decide onde a imagem entra é aritmética sobre o HTML,
 * não um palpite do modelo.
 */

export interface ImageSlot {
  id: string;
  role: 'cover' | 'inline';
  /** Índice do parágrafo depois do qual a imagem entra (só `inline`). */
  afterParagraph?: number;
  /** O que a imagem deve mostrar. Alimenta a visão e o prompt de geração. */
  description: string;
  /** Título da seção onde a imagem cai. */
  heading: string | null;
  query: string;
  size: ImageSize;
  /** Cobertura não é regra dura: se o assunto exigir texto na imagem, pode ter. */
  allowText: boolean;
}

export interface PlanSlotsInput {
  topic: string;
  keywords: string[];
  html: string;
  /** Quantas imagens no corpo além da capa. */
  inlineCount: number;
  coverSize: ImageSize;
  inlineSize: ImageSize;
  /** Dicas do revisor editorial: dizem o que a imagem de cada seção deve mostrar. */
  hints?: SlotHint[];
}

const STOPWORDS = new Set(
  (
    'a o as os um uma uns umas de do da dos das em no na nos nas por para com sem sobre entre ate e ou mas que se ' +
    'como qual quais quando onde ao aos ja mais menos muito muita muitos muitas seu sua seus suas ele ela eles elas ' +
    'isso isto esse essa esses essas este esta estes estas foi sao ser tem ter the of and to in on for with is are'
  ).split(' '),
);

const norm = (s: string) => stripDiacritics(s.toLowerCase());

/** Termos que carregam assunto: sem stopwords, sem números soltos, sem repetição. */
export function keyTerms(text: string, max = 6): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[^\p{L}\p{N}]+/u)) {
    const t = raw.trim();
    if (t.length < 3) continue;
    const key = norm(t);
    if (STOPWORDS.has(key) || /^\d+$/.test(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Consulta de busca: assunto do artigo + o que a seção trata, sem ruído.
 * `hint` é o que o editor disse que a imagem deve mostrar; quando existe, vale
 * mais que a inferência a partir do título e do parágrafo.
 */
export function buildSlotQuery(
  topic: string,
  keywords: string[],
  heading: string | null,
  paragraph: string,
  hint?: string,
): string {
  // O assunto ancora a busca (evita imagem de outro jogo/produto); a seção
  // afina. Duas palavras-chave sozinhas era o que deixava a busca genérica.
  const anchor = keywords.length > 0 ? keywords.slice(0, 2).join(' ') : keyTerms(topic, 4).join(' ');
  const detail = keyTerms(hint ? `${hint} ${heading ?? ''}` : (heading ?? paragraph), 4).join(' ');
  return [anchor, detail].filter(Boolean).join(' ').slice(0, 140).trim();
}

/** A dica cujo título casa com o da seção (ignorando caixa e acento). */
function hintFor(heading: string | null, hints: SlotHint[] | undefined): SlotHint | undefined {
  if (!heading || !hints?.length) return undefined;
  const h = norm(heading).trim();
  return hints.find((x) => x.afterHeading && norm(x.afterHeading).trim() === h);
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);

export function planImageSlots(input: PlanSlotsInput): ImageSlot[] {
  const { topic, keywords } = input;
  const slots: ImageSlot[] = [];

  slots.push({
    id: 'cover',
    role: 'cover',
    description: `Imagem de capa do artigo sobre "${topic}". Deve mostrar o assunto em si e funcionar como miniatura.`,
    heading: null,
    query: buildSlotQuery(topic, keywords, null, topic),
    size: input.coverSize,
    allowText: false,
  });

  const preferHeadings = (input.hints ?? []).map((h) => h.afterHeading).filter((h): h is string => Boolean(h));
  const points = planInlineInsertions(input.html, input.inlineCount, { preferHeadings });
  points.forEach((point, i) => {
    const about = point.heading ? `${point.heading}: ${clip(point.paragraphText, 220)}` : clip(point.paragraphText, 260);
    const hint = hintFor(point.heading, input.hints);
    slots.push({
      id: `inline-${i + 1}`,
      role: 'inline',
      afterParagraph: point.paragraphIndex,
      description:
        `Imagem do corpo do artigo "${topic}", logo após este trecho: ${about}` +
        // o editor disse o que a imagem desta seção deve mostrar: vale mais que a inferência
        (hint ? ` A imagem deve mostrar: ${hint.description}` : ''),
      heading: point.heading,
      query: buildSlotQuery(topic, keywords, point.heading, point.paragraphText, hint?.description),
      size: input.inlineSize,
      allowText: false,
    });
  });

  return slots;
}
