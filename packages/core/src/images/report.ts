/**
 * Relatório de imagens de um artigo: o que entrou, de onde veio e o que faltou.
 *
 * Fica gravado junto da pauta porque a tela de preview precisa dele, e não dá
 * para reconstruí-lo depois lendo só o HTML: o HTML sabe a URL, mas não sabe que
 * uma imagem foi GERADA por IA (o que muda o que o usuário quer fazer com ela)
 * nem que a capa não existe.
 */

export interface ImageReportItem {
  /** 'cover' ou 'inline-N'. */
  slotId: string;
  role: 'cover' | 'inline';
  /** Como a imagem foi obtida. */
  origin: 'search' | 'source' | 'generated';
  /** ID do anexo no WordPress: a identidade da imagem no HTML (`wp-image-ID`). */
  mediaId: number;
  url: string;
  alt: string;
  caption?: string;
  width?: number;
  height?: number;
  /** Página de origem (imagem real); vazio quando gerada. */
  sourcePage?: string;
}

export interface ImageReport {
  /** Nenhuma capa: o post nunca é publicado automaticamente nesse estado. */
  coverMissing: boolean;
  plannedInline: number;
  images: ImageReportItem[];
  /** Uma linha por slot: de onde veio a imagem, ou por que não veio. */
  notes: string[];
}

export function emptyImageReport(): ImageReport {
  return { coverMissing: false, plannedInline: 0, images: [], notes: [] };
}
