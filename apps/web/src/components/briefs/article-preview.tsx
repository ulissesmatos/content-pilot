import { ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ArticleSegment, ImageReport, ImageReportItem } from '@content-pilot/core';
import { RegenerateImageButton } from '@/components/briefs/regenerate-image-button';
import { Badge } from '@/components/ui/badge';

/**
 * O artigo como o leitor o verá: texto, imagens e embeds na ordem do post. Cada
 * imagem traz, logo abaixo, uma barra própria do painel (origem, tamanho, trocar
 * por outra gerada por IA) para não se confundir com o conteúdo.
 */

const ORIGIN_CLASS: Record<ImageReportItem['origin'], string> = {
  generated: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
  source: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  search: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
};

export function findReportItem(
  images: ImageReport,
  seg: { mediaId: number | null; url: string },
): ImageReportItem | undefined {
  return (
    (seg.mediaId ? images.images.find((i) => i.mediaId === seg.mediaId) : undefined) ??
    images.images.find((i) => i.url === seg.url)
  );
}

export function ImageToolbar({
  briefId,
  item,
  canRegenerate,
  live,
}: {
  briefId: string;
  item: ImageReportItem | undefined;
  canRegenerate: boolean;
  live: boolean;
}) {
  const t = useTranslations('preview');
  if (!item) return null;
  const host = (() => {
    try {
      return item.sourcePage ? new URL(item.sourcePage).hostname.replace(/^www\./, '') : null;
    } catch {
      return null;
    }
  })();
  return (
    <div className="bg-muted/60 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md px-2.5 py-1.5 text-xs">
      <span className="font-medium">{item.role === 'cover' ? t('cover') : t('imageN', { n: item.slotId.replace('inline-', '') })}</span>
      <Badge variant="secondary" className={`border-transparent ${ORIGIN_CLASS[item.origin]}`}>
        {t(`origin.${item.origin}`)}
      </Badge>
      {item.width && item.height ? (
        <span className="text-muted-foreground tabular-nums">
          {item.width}×{item.height}
        </span>
      ) : null}
      {item.sourcePage && host ? (
        <a
          href={item.sourcePage}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 hover:underline"
        >
          {host}
          <ExternalLink className="size-3" />
        </a>
      ) : null}
      {canRegenerate ? (
        <span className="ml-auto">
          <RegenerateImageButton briefId={briefId} slotId={item.slotId} live={live} />
        </span>
      ) : null}
    </div>
  );
}

export function CoverPreview({
  briefId,
  item,
  canRegenerate,
  live,
}: {
  briefId: string;
  item: ImageReportItem;
  canRegenerate: boolean;
  live: boolean;
}) {
  return (
    <figure className="space-y-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- URL do WordPress do cliente: domínio desconhecido em build */}
      <img src={item.url} alt={item.alt} className="w-full rounded-lg border object-cover" />
      <ImageToolbar briefId={briefId} item={item} canRegenerate={canRegenerate} live={live} />
    </figure>
  );
}

function Embed({ seg }: { seg: Extract<ArticleSegment, { kind: 'embed' }> }) {
  const t = useTranslations('preview');

  if (seg.provider === 'youtube' && seg.id) {
    return (
      <div className="space-y-1.5">
        <div className="bg-muted aspect-video overflow-hidden rounded-lg border">
          <iframe
            // o id passou por parseYoutubeId (11 caracteres seguros): não há como escapar da URL
            src={`https://www.youtube-nocookie.com/embed/${seg.id}`}
            title={t('videoTitle')}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            allow="encrypted-media; picture-in-picture"
            allowFullScreen
            className="size-full"
          />
        </div>
        <p className="text-muted-foreground text-xs">{t('embedYoutube')}</p>
      </div>
    );
  }

  // Tweet e demais: cartão com link. Carregar o script de terceiros do X dentro do painel
  // logado não vale o risco, e o post real no WordPress mostra o tweet completo.
  const handle = seg.provider === 'tweet' ? /(?:twitter|x)\.com\/([A-Za-z0-9_]+)\//.exec(seg.url)?.[1] : null;
  return (
    <a
      href={seg.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="hover:bg-muted/60 flex items-center justify-between gap-3 rounded-lg border p-3 text-sm transition-colors"
    >
      <span className="min-w-0">
        <span className="block font-medium">
          {seg.provider === 'tweet' && handle ? t('tweetBy', { user: handle }) : t('embedOther')}
        </span>
        <span className="text-muted-foreground block truncate text-xs">{seg.url}</span>
      </span>
      <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-xs">
        {t('openOriginal')}
        <ExternalLink className="size-3" />
      </span>
    </a>
  );
}

export function ArticlePreview({
  briefId,
  segments,
  images,
  canRegenerate,
  live,
}: {
  briefId: string;
  segments: ArticleSegment[];
  images: ImageReport;
  canRegenerate: boolean;
  live: boolean;
}) {
  return (
    <div className="article-body space-y-6">
      {segments.map((seg, i) => {
        if (seg.kind === 'html') {
          // já sanitizado em loadBriefPreview (sanitize-html); nada além de tags de texto chega aqui
          return <div key={i} dangerouslySetInnerHTML={{ __html: seg.html }} />;
        }
        if (seg.kind === 'embed') return <Embed key={i} seg={seg} />;
        return (
          <figure key={i} className="space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- URL do WordPress do cliente: domínio desconhecido em build */}
            <img src={seg.url} alt={seg.alt} loading="lazy" className="w-full rounded-lg border" />
            {seg.caption ? <figcaption className="text-muted-foreground text-xs">{seg.caption}</figcaption> : null}
            <ImageToolbar
              briefId={briefId}
              item={findReportItem(images, seg)}
              canRegenerate={canRegenerate}
              live={live}
            />
          </figure>
        );
      })}
    </div>
  );
}
