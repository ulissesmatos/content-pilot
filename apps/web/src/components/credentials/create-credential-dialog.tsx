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
import { CredentialForm } from './credential-form';

export function CreateCredentialDialog({ isAdmin = false }: { isAdmin?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          Nova credencial
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova credencial</DialogTitle>
          <DialogDescription>
            O segredo é criptografado no banco e nunca é exibido novamente.
          </DialogDescription>
        </DialogHeader>
        <CredentialForm isAdmin={isAdmin} onSuccess={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
