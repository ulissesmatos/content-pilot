'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { createSiteAction } from '@/actions/sites';
import { QuickCreateCredentialDialog } from '@/components/credentials/quick-create-credential-dialog';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LANGUAGES } from '@/lib/languages';

interface CredentialOption {
  id: string;
  name: string;
}

/** Form de criação de site reutilizado pelo diálogo da página e pela criação rápida embutida no job. */
export function SiteForm({
  wordpressCredentials,
  onSuccess,
}: {
  wordpressCredentials: CredentialOption[];
  onSuccess: (site: { id: string; name: string }) => void;
}) {
  const [extraCredentials, setExtraCredentials] = useState<CredentialOption[]>([]);
  const [credentialId, setCredentialId] = useState<string>('');
  const [language, setLanguage] = useState('pt-BR');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();
  const submittingRef = useRef(false);

  const credentials = useMemo(
    () => [...wordpressCredentials, ...extraCredentials],
    [wordpressCredentials, extraCredentials],
  );

  function submit(formData: FormData) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    startTransition(async () => {
      try {
        const name = String(formData.get('name') ?? '').trim();
        const result = await createSiteAction({
          name,
          baseUrl: formData.get('baseUrl'),
          credentialId,
          defaultLanguage: language,
        });
        if (result.ok) {
          toast.success('Site conectado. Use "Testar conexão" para validar as credenciais.');
          setFieldErrors({});
          onSuccess({ id: result.data.id, name });
        } else {
          setFieldErrors(result.fieldErrors ?? {});
          toast.error(result.error);
        }
      } finally {
        submittingRef.current = false;
      }
    });
  }

  const err = (field: string) => fieldErrors[field]?.[0];
  const noCredentials = credentials.length === 0;

  return (
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
        <div className="flex items-center justify-between">
          <Label>Credencial (application password)</Label>
          <QuickCreateCredentialDialog
            defaultType="wordpress"
            label="Nova credencial WordPress"
            onCreated={(cred) => {
              setExtraCredentials((prev) => [...prev, { id: cred.id, name: cred.name }]);
              setCredentialId(cred.id);
            }}
          />
        </div>
        <Select value={credentialId} onValueChange={setCredentialId} disabled={noCredentials}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={noCredentials ? 'Nenhuma credencial WordPress' : 'Selecione'} />
          </SelectTrigger>
          <SelectContent>
            {credentials.map((c) => (
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
  );
}
