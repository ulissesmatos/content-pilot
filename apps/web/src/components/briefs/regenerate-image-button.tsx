'use client';

import { useState, useTransition } from 'react';
import { ImagePlus, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { regenerateImageAction } from '@/actions/briefs';
import { useRunTracker } from '@/components/runs/run-tracker';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/**
 * Pede uma imagem nova, gerada por IA, no lugar de uma do artigo (ou a capa que
 * faltou). O trabalho roda no worker; o painel de acompanhamento mostra o andamento
 * e, ao terminar, recarrega esta página com a imagem trocada.
 */
export function RegenerateImageButton({
  briefId,
  slotId,
  live,
  missing = false,
  primary = false,
}: {
  briefId: string;
  /** 'cover' ou 'inline-N'. */
  slotId: string;
  /** O post já está publicado: a troca aparece no site na hora. */
  live: boolean;
  /** É uma imagem que não existe (capa que faltou), não a troca de uma existente. */
  missing?: boolean;
  primary?: boolean;
}) {
  const t = useTranslations('preview');
  const { track } = useRunTracker();
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={primary ? 'default' : 'outline'} className={primary ? undefined : 'h-7 text-xs'}>
          {missing ? <ImagePlus className="size-4" /> : <Sparkles className="size-3.5" />}
          {missing ? t('generateCover') : t('regenerate')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{missing ? t('generateCover') : t('regenerateTitle')}</DialogTitle>
          <DialogDescription>{missing ? t('generateCoverDescription') : t('regenerateDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor={`regen-${slotId}`}>{t('regenerateLabel')}</Label>
          <Textarea
            id={`regen-${slotId}`}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder={t('regeneratePlaceholder')}
          />
          {live ? <p className="text-muted-foreground text-xs">{t('livePostWarning')}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {t('cancel')}
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await regenerateImageAction({ id: briefId, slotId, instruction });
                if (result.ok) {
                  setOpen(false);
                  setInstruction('');
                  track(result.data.runId);
                } else {
                  toast.error(result.error);
                }
              })
            }
          >
            {pending ? t('regenerating') : t('regenerateConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
