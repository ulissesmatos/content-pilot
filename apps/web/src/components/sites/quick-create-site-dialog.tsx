'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SiteForm } from './site-form';

/** Botão "+" compacto para conectar um site sem sair do formulário de job. */
export function QuickCreateSiteDialog({
  wordpressCredentials,
  onCreated,
}: {
  wordpressCredentials: { id: string; name: string }[];
  onCreated: (site: { id: string; name: string }) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground"
              aria-label="Novo site"
            >
              <Plus className="size-3.5" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Novo site</TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Conectar site WordPress</DialogTitle>
          <DialogDescription>
            Informe a URL do site e escolha (ou crie) a credencial de application password.
          </DialogDescription>
        </DialogHeader>
        <SiteForm
          wordpressCredentials={wordpressCredentials}
          onSuccess={(site) => {
            setOpen(false);
            onCreated(site);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
