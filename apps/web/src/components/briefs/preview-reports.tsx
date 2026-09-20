import { useLocale, useTranslations } from 'next-intl';
import type { EditorialReport, ImageReport } from '@content-pilot/core';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/** Os relatórios que a geração deixou: o que a revisão achou, de onde veio cada imagem, quais embeds entraram. */

const REVIEW_TONE: Record<string, string> = {
  revised: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  unchanged: 'bg-muted text-muted-foreground',
  rejected: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  failed: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  budget_exceeded: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
};

export function ReviewCard({ report }: { report: EditorialReport | null }) {
  const t = useTranslations('preview');
  const review = report?.review ?? null;

  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          {t('reviewTitle')}
          {review ? (
            <Badge variant="secondary" className={`border-transparent ${REVIEW_TONE[review.status] ?? ''}`}>
              {t(`reviewStatus.${review.status}`)}
            </Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!review ? (
          <p className="text-muted-foreground">{t('reviewNone')}</p>
        ) : (
          <>
            {review.status === 'rejected' ? (
              <p className="text-muted-foreground">
                {t('reviewRejected')}
                {review.reason ? <span className="mt-1 block text-xs">{review.reason}</span> : null}
              </p>
            ) : null}
            {review.changes.length > 0 ? (
              <ul className="space-y-2">
                {review.changes.map((c, i) => (
                  <li key={i} className="space-y-0.5">
                    <p className="text-xs font-medium">
                      {t(`changeKind.${c.kind}`)}
                      {c.section ? <span className="text-muted-foreground font-normal"> · {c.section}</span> : null}
                    </p>
                    <p className="text-muted-foreground">{c.note}</p>
                  </li>
                ))}
              </ul>
            ) : null}
            {review.remainingTells.length > 0 ? (
              <div className="rounded-md bg-amber-50 p-2.5 text-xs dark:bg-amber-950/40">
                <p className="font-medium">{t('remainingTells')}</p>
                <p className="text-muted-foreground mt-1">{review.remainingTells.map((x) => `“${x}”`).join(', ')}</p>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function ImagesCard({ images }: { images: ImageReport }) {
  const t = useTranslations('preview');
  const locale = useLocale();
  const counts = { generated: 0, source: 0, search: 0 };
  for (const i of images.images) counts[i.origin]++;
  const real = counts.source + counts.search;
  const summaryParts = [
    real > 0 ? t('imagesReal', { count: real }) : '',
    counts.generated > 0 ? t('imagesGenerated', { count: counts.generated }) : '',
  ].filter(Boolean);

  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle className="text-sm">{t('imagesTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {images.images.length === 0 ? (
          <p className="text-muted-foreground">{t('imagesEmpty')}</p>
        ) : (
          <p className="text-muted-foreground">
            {t('imagesTotal', { count: images.images.length })}
            {summaryParts.length > 0 ? `: ${new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(summaryParts)}.` : '.'}
          </p>
        )}
        {images.notes.length > 0 ? (
          <details className="text-xs">
            <summary className="text-muted-foreground hover:text-foreground cursor-pointer select-none">
              {t('imagesNotes')}
            </summary>
            <ul className="text-muted-foreground mt-2 list-disc space-y-1 pl-4">
              {images.notes.map((n, i) => (
                <li key={i} className="break-words">
                  {n}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function EmbedsCard({ report }: { report: EditorialReport | null }) {
  const t = useTranslations('preview');
  const embeds = report?.embeds ?? [];
  const notes = report?.embedNotes ?? [];

  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle className="text-sm">{t('embedsTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {embeds.length === 0 ? (
          <p className="text-muted-foreground">{t('embedsEmpty')}</p>
        ) : (
          <ul className="space-y-2">
            {embeds.map((e) => (
              <li key={e.url} className="space-y-0.5">
                <p className="text-xs font-medium">{e.kind === 'youtube' ? t('embedYoutube') : t('embedTweet')}</p>
                <p className="text-muted-foreground break-words">
                  {e.title ? `${e.title}` : e.url}
                  {e.author ? <span className="text-xs"> · {e.author}</span> : null}
                </p>
              </li>
            ))}
          </ul>
        )}
        {notes.length > 0 ? (
          <ul className="text-muted-foreground list-disc space-y-1 pl-4 text-xs">
            {notes.map((n, i) => (
              <li key={i} className="break-words">
                {n}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
