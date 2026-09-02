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
import { SiteForm } from './site-form';

export function CreateSiteDialog({
  wordpressCredentials,
}: {
  wordpressCredentials: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          Novo site
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Conectar site WordPress</DialogTitle>
          <DialogDescription>
            Informe a URL do site e escolha (ou crie) a credencial de application password.
          </DialogDescription>
        </DialogHeader>
        <SiteForm wordpressCredentials={wordpressCredentials} onSuccess={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
