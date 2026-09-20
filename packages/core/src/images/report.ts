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
  origin: 'search' | 'source' | 'generated' | 'upload';
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

/**
 * Registra no relatório a imagem que acabou de entrar no lugar de um slot (ou que
 * passou a existir, como a capa que faltava). O slot é a chave: a nova imagem
 * substitui a anterior e o que era "sem capa" deixa de ser.
 */
export function withReplacedImage(report: ImageReport, item: ImageReportItem): ImageReport {
  const images = report.images.filter((i) => i.slotId !== item.slotId);
  images.push(item);
  // capa primeiro, depois o corpo na ordem dos slots
  images.sort((a, b) => (a.role === b.role ? a.slotId.localeCompare(b.slotId, 'en', { numeric: true }) : a.role === 'cover' ? -1 : 1));
  const cover = images.some((i) => i.role === 'cover');
  return { ...report, images, coverMissing: !cover };
}

/** Lê o relatório gravado no banco (jsonb): devolve o vazio se não houver ou vier torto. */
export function parseImageReport(value: unknown): ImageReport {
  if (!value || typeof value !== 'object') return emptyImageReport();
  const v = value as Partial<ImageReport>;
  const images = Array.isArray(v.images)
    ? v.images.filter(
        (i): i is ImageReportItem =>
          !!i && typeof i === 'object' && typeof i.slotId === 'string' && typeof i.mediaId === 'number' && typeof i.url === 'string',
      )
    : [];
  return {
    coverMissing: typeof v.coverMissing === 'boolean' ? v.coverMissing : !images.some((i) => i.role === 'cover'),
    plannedInline: typeof v.plannedInline === 'number' ? v.plannedInline : 0,
    images,
    notes: Array.isArray(v.notes) ? v.notes.filter((n): n is string => typeof n === 'string') : [],
  };
}
