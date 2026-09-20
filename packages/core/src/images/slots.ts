import { planInlineInsertions } from '../html/inline-images';
import { stripDiacritics } from '../i18n/slug';
import type { ImageSize } from './generate';

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
  /**
   * Posição do slot entre as imagens do corpo (base 0). É o `slotIndex` que
   * `injectPlannedImages` usa para pôr a imagem no ponto do PRÓPRIO slot.
   */
  inlineIndex?: number;
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

/** Consulta de busca: assunto do artigo + o que a seção trata, sem ruído. */
export function buildSlotQuery(topic: string, keywords: string[], heading: string | null, paragraph: string): string {
  // O assunto ancora a busca (evita imagem de outro jogo/produto); a seção
  // afina. Duas palavras-chave sozinhas era o que deixava a busca genérica.
  const anchor = keywords.length > 0 ? keywords.slice(0, 2).join(' ') : keyTerms(topic, 4).join(' ');
  const detail = keyTerms(heading ?? paragraph, 4).join(' ');
  return [anchor, detail].filter(Boolean).join(' ').slice(0, 140).trim();
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

  const points = planInlineInsertions(input.html, input.inlineCount);
  points.forEach((point, i) => {
    const about = point.heading ? `${point.heading}: ${clip(point.paragraphText, 220)}` : clip(point.paragraphText, 260);
    slots.push({
      id: `inline-${i + 1}`,
      role: 'inline',
      afterParagraph: point.paragraphIndex,
      inlineIndex: i,
      description: `Imagem do corpo do artigo "${topic}", logo após este trecho: ${about}`,
      heading: point.heading,
      query: buildSlotQuery(topic, keywords, point.heading, point.paragraphText),
      size: input.inlineSize,
      allowText: false,
    });
  });

  return slots;
}
