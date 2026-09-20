import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertTriangle, ArrowLeft, ExternalLink, ImageOff } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { ArticlePreview, CoverPreview } from '@/components/briefs/article-preview';
import { PublishBriefButton } from '@/components/briefs/brief-row-actions';
import { EditImageButton, ImageEditor } from '@/components/briefs/image-editor';
import { EmbedsCard, ImagesCard, ReviewCard } from '@/components/briefs/preview-reports';
import { RegenerateImageButton } from '@/components/briefs/regenerate-image-button';
import { EditableTitle, EditTextButton, TextEditBar, TextEditProvider } from '@/components/briefs/text-editor';
import { AutoRefresh } from '@/components/auto-refresh';
import { StatusBadge } from '@/components/status-badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { requireSession } from '@/lib/auth';
import { loadBriefPreview } from '@/lib/brief-preview';

export const metadata = { title: 'Prévia do artigo' };

/** Link para ver o post no WordPress: rascunho só abre com `preview=true`. */
function wpLink(url: string, status: string): string {
  if (status !== 'ready_for_review') return url;
  return `${url}${url.includes('?') ? '&' : '?'}preview=true`;
}

export default async function BriefPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const { workspaceId } = await requireSession();
  const [data, t, tEditor] = await Promise.all([
    loadBriefPreview(workspaceId, id),
    getTranslations('preview'),
    getTranslations('editor'),
  ]);
  if (!data) notFound();

  const { brief, post, images, editorial } = data;
  const generating = brief.status === 'queued' || brief.status === 'generating';
  const created = brief.status === 'ready_for_review' || brief.status === 'published';
  const live = brief.status === 'published';

  // A capa é obrigatória. O que o WordPress diz agora vale mais que o relatório da geração:
  // o usuário pode ter posto uma capa por lá.
  const coverMissing = post ? !post.hasCover : images.coverMissing;
  const cover = images.images.find((i) => i.role === 'cover');
  const canRegenerate = created && Boolean(post) && !data.postError;
  // Texto e imagens do texto só se editam com o conteúdo em blocos do WordPress; a capa só precisa do post.
  const canEditText = created && Boolean(post?.editable);
  const canEditCover = created && Boolean(post);

  const title = post?.title || brief.topic;

  return (
    <TextEditProvider briefId={brief.id} initialTitle={title} canEdit={canEditText}>
    <div className="mx-auto max-w-6xl space-y-6">
      <AutoRefresh enabled={generating} />

      <div className="space-y-4">
        <Link href="/briefs" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm">
          <ArrowLeft className="size-4" />
          {t('back')}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <EditableTitle className="text-2xl font-semibold tracking-tight break-words" />
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <StatusBadge status={brief.status} />
              <span>{data.siteName}</span>
              <span aria-hidden>·</span>
              <span>{data.templateName}</span>
              {post?.wpStatus ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{t.has(`wpStatus.${post.wpStatus}` as never) ? t(`wpStatus.${post.wpStatus}` as never) : post.wpStatus}</span>
                </>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <EditTextButton />
            {brief.createdWpPostUrl ? (
              <Button asChild variant="outline" size="sm">
                <a href={wpLink(brief.createdWpPostUrl, brief.status)} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-4" />
                  {t('openWp')}
                </a>
              </Button>
            ) : null}
            {brief.status === 'ready_for_review' ? (
              coverMissing ? (
                <span className="text-muted-foreground text-xs">{t('publishNeedsCover')}</span>
              ) : (
                <PublishBriefButton id={brief.id} />
              )
            ) : null}
          </div>
        </div>
      </div>

      {generating ? (
        <Alert variant="info">
          <AlertTitle>{t('generatingTitle')}</AlertTitle>
          <AlertDescription>{t('generatingBody')}</AlertDescription>
        </Alert>
      ) : null}

      {brief.status === 'failed' ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>{t('failedTitle')}</AlertTitle>
          <AlertDescription>{brief.error ?? t('failedBody')}</AlertDescription>
        </Alert>
      ) : null}

      {data.postError ? (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertTitle>{t('postErrorTitle')}</AlertTitle>
          <AlertDescription>{data.postError}</AlertDescription>
        </Alert>
      ) : null}

      {created && coverMissing ? (
        <Alert variant="warning">
          <ImageOff />
          <AlertTitle>{t('coverMissingTitle')}</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{t('coverMissingBody')}</p>
            <div className="flex flex-wrap items-center gap-2">
              {canEditCover ? (
                <ImageEditor
                  briefId={brief.id}
                  target={{ kind: 'cover' }}
                  current={null}
                  enabled
                  size={data.imageSizes.cover}
                  className="inline-block"
                >
                  <EditImageButton variant="default" label={tEditor('uploadCover')} />
                </ImageEditor>
              ) : null}
              {canRegenerate ? (
                <RegenerateImageButton briefId={brief.id} slotId="cover" live={live} missing />
              ) : null}
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {created || post ? (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          {post ? (
            <Card className="py-0">
              <CardContent className="space-y-6 p-5 sm:p-8">
                <TextEditBar />
                {cover && !coverMissing ? (
                  <CoverPreview
                    briefId={brief.id}
                    item={cover}
                    canRegenerate={canRegenerate}
                    canEdit={canEditCover}
                    size={data.imageSizes.cover}
                    live={live}
                  />
                ) : null}
                <ArticlePreview
                  briefId={brief.id}
                  segments={post.segments}
                  images={images}
                  canRegenerate={canRegenerate}
                  canEditImages={canEditText}
                  inlineSize={data.imageSizes.inline}
                  live={live}
                />
              </CardContent>
            </Card>
          ) : (
            <p className="text-muted-foreground text-sm">{brief.createdWpPostId ? t('postUnavailable') : t('noPost')}</p>
          )}

          {/* os relatórios da geração valem mesmo quando o texto do WordPress não carregou */}
          <aside className="space-y-4 lg:sticky lg:top-4">
            <ReviewCard report={editorial} />
            <ImagesCard images={images} />
            <EmbedsCard report={editorial} />
          </aside>
        </div>
      ) : !generating && brief.status !== 'failed' ? (
        <p className="text-muted-foreground text-sm">{t('noPost')}</p>
      ) : null}
    </div>
    </TextEditProvider>
  );
}
