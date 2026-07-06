'use client';

import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { createSiteAction } from '@/actions/sites';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const LANGUAGES = [
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'es-ES', label: 'Español (España)' },
];

export function CreateSiteDialog({
  wordpressCredentials,
}: {
  wordpressCredentials: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [credentialId, setCredentialId] = useState<string>('');
  const [language, setLanguage] = useState('pt-BR');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await createSiteAction({
        name: formData.get('name'),
        baseUrl: formData.get('baseUrl'),
        credentialId,
        defaultLanguage: language,
      });
      if (result.ok) {
        toast.success('Site conectado. Use "Testar conexão" para validar as credenciais.');
        setFieldErrors({});
        setOpen(false);
      } else {
        setFieldErrors(result.fieldErrors ?? {});
        toast.error(result.error);
      }
    });
  }

  const err = (field: string) => fieldErrors[field]?.[0];
  const noCredentials = wordpressCredentials.length === 0;

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
            {noCredentials
              ? 'Salve primeiro uma credencial do tipo WordPress na página Credenciais.'
              : 'Informe a URL do site e escolha a credencial de application password.'}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="site-name">Nome</Label>
            <Input id="site-name" name="name" placeholder="ex.: DeepGames" required />
            {err('name') ? <p className="text-destructive text-xs">{err('name')}</p> : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="site-url">URL base</Label>
            <Input id="site-url" name="baseUrl" type="url" placeholder="https://exemplo.com.br" required />
            {err('baseUrl') ? <p className="text-destructive text-xs">{err('baseUrl')}</p> : null}
          </div>
          <div className="space-y-2">
            <Label>Credencial (application password)</Label>
            <Select value={credentialId} onValueChange={setCredentialId} disabled={noCredentials}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={noCredentials ? 'Nenhuma credencial WordPress' : 'Selecione'} />
              </SelectTrigger>
              <SelectContent>
                {wordpressCredentials.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {err('credentialId') ? <p className="text-destructive text-xs">{err('credentialId')}</p> : null}
          </div>
          <div className="space-y-2">
            <Label>Idioma padrão do conteúdo</Label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || noCredentials || !credentialId}>
              {pending ? 'Conectando...' : 'Conectar site'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
