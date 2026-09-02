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
import { CredentialForm } from './credential-form';
import type { CredentialType } from './credential-type';

/** Botão "+" compacto para criar uma credencial sem sair do formulário atual (ex.: dentro da criação de site/job). */
export function QuickCreateCredentialDialog({
  defaultType,
  label = 'Nova credencial',
  onCreated,
}: {
  defaultType?: CredentialType;
  label?: string;
  onCreated: (credential: { id: string; name: string; type: CredentialType }) => void;
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
              aria-label={label}
            >
              <Plus className="size-3.5" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova credencial</DialogTitle>
          <DialogDescription>
            O segredo é criptografado no banco e nunca é exibido novamente.
          </DialogDescription>
        </DialogHeader>
        <CredentialForm
          defaultType={defaultType}
          onSuccess={(credential) => {
            setOpen(false);
            onCreated(credential);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
