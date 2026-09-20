'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { ImagePlus, ImageUp, Pencil, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { updateImageSeoAction } from '@/actions/brief-edit';
import { Field, FormSection, stickyFooterClass } from '@/components/form-layout';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { imageFromClipboard, imageFromTransfer, usefulFileName, type DroppedImage } from '@/lib/image-drop';
import { cn } from '@/lib/utils';

/**
 * Troca de imagem e ajuste de SEO direto no artigo.
 *
 * `ImageEditor` envolve uma imagem (ou o botão "Enviar capa") e faz três coisas: aceita uma imagem
 * ARRASTADA por cima (do computador ou de outra página), aceita uma imagem COLADA (Ctrl+V com a
 * imagem em foco) e abre o diálogo de edição para o botão "Editar imagem". Em todos os casos o
 * envio vai para /api/briefs/[id]/image, que converte para WebP e atualiza o post.
 */

const MAX_MB = 15;

export interface EditableImage {
  url: string;
  alt: string;
  caption: string;
}

export type EditTarget = { kind: 'cover'; mediaId?: number } | { kind: 'inline'; mediaId: number };

type Initial = DroppedImage;

interface EditorContext {
  open: (initial?: Initial) => void;
}
const Ctx = createContext<EditorContext | null>(null);

/** Aberto por quem está dentro de um `ImageEditor` habilitado; fora dele devolve null. */
export function useImageEditor(): EditorContext | null {
  return useContext(Ctx);
}

export function ImageEditor({
  briefId,
  target,
  current,
  enabled,
  size,
  children,
  className,
}: {
  briefId: string;
  target: EditTarget;
  /** A imagem que está no artigo agora; null quando não há (capa que faltou). */
  current: EditableImage | null;
  enabled: boolean;
  /** Tamanho final do template para este papel. */
  size: { width: number; height: number };
  children: ReactNode;
  className?: string;
}) {
  const t = useTranslations('editor');
  const [session, setSession] = useState<{ id: number; initial: Initial } | null>(null);
  const [over, setOver] = useState(false);
  const seq = useRef(0);

  const open = useCallback((initial: Initial = {}) => setSession({ id: ++seq.current, initial }), []);
  const value = useMemo(() => (enabled ? { open } : null), [enabled, open]);

  if (!enabled) return <div className={className}>{children}</div>;

  const wantsDrop = (e: DragEvent) => [...e.dataTransfer.types].some((x) => x === 'Files' || x === 'text/uri-list' || x === 'text/html');

  return (
    <Ctx.Provider value={value}>
      <div
        className={cn('relative rounded-lg outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring', over && 'outline-primary outline-2 outline-dashed', className)}
        tabIndex={0}
        role="group"
        title={t('pasteHint')}
        onDragOver={(e) => {
          if (!wantsDrop(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        }}
        onDrop={(e) => {
          setOver(false);
          const found = imageFromTransfer(e.dataTransfer);
          if (!found) return;
          e.preventDefault();
          open(found);
        }}
        onPaste={(e) => {
          // dentro do diálogo (campo de texto) a colagem é do campo; só a imagem em foco reage
          if ((e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return;
          const found = imageFromClipboard(e.clipboardData);
          if (!found) return;
          e.preventDefault();
          open(found);
        }}
      >
        {children}
        {over ? (
          <div className="bg-primary/10 text-primary pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg text-sm font-medium backdrop-blur-[1px]">
            <ImageUp className="mr-2 size-5" />
            {t('dropOverlay')}
          </div>
        ) : null}
      </div>
      {session ? (
        <ImageEditDialog
          key={session.id}
          briefId={briefId}
          target={target}
          current={current}
          size={size}
          initial={session.initial}
          onClose={() => setSession(null)}
        />
      ) : null}
    </Ctx.Provider>
  );
}

/** Botão que abre o diálogo de edição da imagem em que está. */
export function EditImageButton({ label, variant = 'outline', className }: { label?: string; variant?: 'outline' | 'default'; className?: string }) {
  const t = useTranslations('editor');
  const editor = useImageEditor();
  if (!editor) return null;
  return (
    <Button type="button" size="sm" variant={variant} className={cn(variant === 'outline' && 'h-7 text-xs', className)} onClick={() => editor.open()}>
      {variant === 'outline' ? <Pencil className="size-3.5" /> : <ImagePlus className="size-4" />}
      {label ?? t('editImage')}
    </Button>
  );
}

const formatBytes = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

function ImageEditDialog({
  briefId,
  target,
  current,
  size,
  initial,
  onClose,
}: {
  briefId: string;
  target: EditTarget;
  current: EditableImage | null;
  size: { width: number; height: number };
  initial: Initial;
  onClose: () => void;
}) {
  const t = useTranslations('editor');
  const router = useRouter();
  const isCover = target.kind === 'cover';

  const [file, setFile] = useState<File | null>(initial.file ?? null);
  const [preview, setPreview] = useState<string | null>(() => (initial.file ? URL.createObjectURL(initial.file) : null));
  const [remoteUrl, setRemoteUrl] = useState(initial.url ?? '');
  const [alt, setAlt] = useState(current?.alt ?? '');
  const [title, setTitle] = useState('');
  // Imagem nova já na abertura (arrastada ou colada): a legenda antiga era da imagem que sai e não vem junto.
  const startsWithNew = Boolean(initial.file || initial.url);
  const [caption, setCaption] = useState(startsWithNew ? '' : (current?.caption ?? ''));
  const [filename, setFilename] = useState(() => (initial.file ? usefulFileName(initial.file.name) : ''));
  const [captionCleared, setCaptionCleared] = useState(Boolean(startsWithNew && current?.caption));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // O endereço temporário da pré-visualização é liberado quando ela sai de cena (trocar, descartar,
  // fechar), e não por efeito de desmontagem: o modo estrito do React simula uma desmontagem logo após
  // montar e revogaria a imagem que acabou de aparecer.
  const closeDialog = () => {
    if (preview) URL.revokeObjectURL(preview);
    onClose();
  };

  const hasNew = Boolean(file) || remoteUrl.trim().length > 0;

  // A legenda antiga costuma ser a atribuição da imagem que saiu (ex.: "Fonte: IGN"): ao trocar, é limpa.
  const noteNewImage = () => {
    if (current?.caption && caption === current.caption) {
      setCaption('');
      setCaptionCleared(true);
    }
  };

  const chooseFile = (f: File | null) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) return setError(t('notImage'));
    if (f.size > MAX_MB * 1_000_000) return setError(t('tooLarge', { max: MAX_MB }));
    setError(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(f));
    setFile(f);
    setRemoteUrl('');
    setFilename(usefulFileName(f.name));
    noteNewImage();
  };

  const discardNew = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setFile(null);
    setRemoteUrl('');
    setFilename('');
    setError(null);
  };

  // Soltar ou colar DENTRO do diálogo também troca a nova imagem. Sem tratar o drop aqui o navegador
  // abriria o arquivo na aba e o usuário perderia o que estava fazendo.
  const acceptDropped = (found: DroppedImage | null) => {
    if (!found) return;
    if (found.file) return chooseFile(found.file);
    if (found.url) {
      if (preview) URL.revokeObjectURL(preview);
      setPreview(null);
      setFile(null);
      setError(null);
      setRemoteUrl(found.url);
      noteNewImage();
    }
  };

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (hasNew) {
        const fd = new FormData();
        fd.set('target', target.kind);
        if (target.mediaId) fd.set('mediaId', String(target.mediaId));
        fd.set('alt', alt);
        fd.set('title', title);
        fd.set('caption', caption);
        if (filename.trim()) fd.set('filename', filename.trim());
        if (file) fd.set('file', file, file.name);
        else fd.set('sourceUrl', remoteUrl.trim());

        const res = await fetch(`/api/briefs/${briefId}/image`, { method: 'POST', body: fd });
        const json = (await res.json().catch(() => null)) as
          | { ok: true; sourceBytes: number; sourceWidth: number; sourceHeight: number; bytes: number; width: number; height: number; upscaled: boolean }
          | { ok: false; error: string }
          | null;
        if (!res.ok || !json || !json.ok) throw new Error((json && !json.ok && json.error) || `Falha ao enviar (HTTP ${res.status}).`);
        toast.success(t('uploaded', { before: formatBytes(json.sourceBytes), after: formatBytes(json.bytes), size: `${json.width}×${json.height}` }));
        if (json.upscaled) toast.warning(t('upscaled', { size: `${json.sourceWidth}×${json.sourceHeight}` }));
      } else {
        const result = await updateImageSeoAction({
          id: briefId,
          target: target.kind === 'cover' ? { kind: 'cover' } : { kind: 'inline', mediaId: target.mediaId },
          seo: { alt, title, caption },
        });
        if (!result.ok) throw new Error(result.error);
        toast.success(t('seoSaved'));
      }
      router.refresh();
      closeDialog();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const sizeLabel = `${size.width}×${size.height}`;

  return (
    <Dialog open onOpenChange={(next) => (next || busy ? undefined : closeDialog())}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isCover ? t('dialogTitleCover') : t('dialogTitle')}</DialogTitle>
          <DialogDescription>{t('dialogDescription')}</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            acceptDropped(imageFromTransfer(e.dataTransfer));
          }}
          onPaste={(e) => {
            // colar texto num campo é do campo; só a imagem colada troca a nova imagem
            const found = imageFromClipboard(e.clipboardData);
            if (found?.file || ((e.target as HTMLElement).closest('input, textarea') === null && found)) {
              e.preventDefault();
              acceptDropped(found);
            }
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{t('current')}</p>
              <div className="bg-muted flex aspect-video items-center justify-center overflow-hidden rounded-lg border">
                {current ? (
                  // eslint-disable-next-line @next/next/no-img-element -- URL do WordPress do cliente
                  <img src={current.url} alt={current.alt} className="size-full object-contain" />
                ) : (
                  <span className="text-muted-foreground text-xs">{t('noCurrent')}</span>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">{t('newImage')}</p>
              {file || remoteUrl.trim() ? (
                <div className="bg-muted relative flex aspect-video items-center justify-center overflow-hidden rounded-lg border">
                  {/* eslint-disable-next-line @next/next/no-img-element -- pré-visualização local ou de uma URL da web */}
                  <img src={preview ?? remoteUrl.trim()} alt="" className="size-full object-contain" />
                  <Button type="button" size="icon" variant="secondary" className="absolute top-1.5 right-1.5 size-7" onClick={discardNew} aria-label={t('discardNew')} title={t('discardNew')}>
                    <X className="size-4" />
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="text-muted-foreground hover:bg-muted/50 flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-3 text-center text-xs transition-colors"
                >
                  <ImageUp className="size-6" />
                  {t('dropHere')}
                </button>
              )}
              <input ref={fileInput} type="file" accept="image/*" className="sr-only" onChange={(e) => chooseFile(e.target.files?.[0] ?? null)} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => fileInput.current?.click()}>
                <ImageUp className="size-4" />
                {t('chooseFile')}
              </Button>
              <p className="text-muted-foreground text-xs">
                {hasNew ? (isCover ? t('willConvertCover', { size: sizeLabel }) : t('willConvertInline', { size: sizeLabel })) : ''}
              </p>
            </div>
            <Field label={t('urlLabel')} htmlFor="img-url">
              <Input
                id="img-url"
                inputMode="url"
                placeholder={t('urlPlaceholder')}
                value={remoteUrl}
                disabled={Boolean(file)}
                onChange={(e) => {
                  setRemoteUrl(e.target.value);
                  if (e.target.value.trim()) noteNewImage();
                }}
              />
            </Field>
          </div>

          <FormSection title={t('seoTitle')}>
            <Field
              label={t('altLabel')}
              htmlFor="img-alt"
              hint={hasNew && alt && alt === current?.alt ? t('altStale') : t('altHint')}
              action={<span className={cn('text-xs tabular-nums', alt.length > 125 ? 'text-amber-600' : 'text-muted-foreground')}>{alt.length}/125</span>}
            >
              <Textarea id="img-alt" rows={2} maxLength={300} value={alt} onChange={(e) => setAlt(e.target.value)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('titleLabel')} htmlFor="img-title" hint={t('titleHint')}>
                <Input id="img-title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              {hasNew ? (
                <Field label={t('filenameLabel')} htmlFor="img-filename" hint={t('filenameHint')}>
                  <div className="flex items-center gap-1.5">
                    <Input id="img-filename" maxLength={80} value={filename} onChange={(e) => setFilename(e.target.value)} />
                    <span className="text-muted-foreground text-sm">.webp</span>
                  </div>
                </Field>
              ) : null}
            </div>
            <Field label={t('captionLabel')} htmlFor="img-caption" hint={captionCleared ? t('captionCleared') : t('captionHint')}>
              <Input id="img-caption" maxLength={500} value={caption} onChange={(e) => setCaption(e.target.value)} />
            </Field>
          </FormSection>

          {error ? (
            <p className="bg-destructive/10 text-destructive rounded-md p-3 text-sm break-words" role="alert">
              {error}
            </p>
          ) : null}

          <DialogFooter className={stickyFooterClass}>
            <Button type="button" variant="outline" onClick={closeDialog} disabled={busy}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? t('saving') : hasNew ? t('replace') : t('saveSeo')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
