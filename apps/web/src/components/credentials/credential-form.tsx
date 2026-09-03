'use client';

import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { createCredentialAction } from '@/actions/credentials';
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
import { CREDENTIAL_TYPES, type CredentialType } from './credential-type';

interface CreatedCredential {
  id: string;
  name: string;
  type: CredentialType;
}

/** Form de criação de credencial reutilizado pelo diálogo da página e pela criação rápida embutida em outros forms. */
export function CredentialForm({
  defaultType = 'wordpress',
  onSuccess,
}: {
  defaultType?: CredentialType;
  /** Admin da plataforma pode criar credenciais globais (fallback de todos os workspaces). */
  onSuccess: (credential: CreatedCredential) => void;
}) {
  const [type, setType] = useState<CredentialType>(defaultType);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();
  const submittingRef = useRef(false);

  function submit(formData: FormData) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    startTransition(async () => {
      try {
        const name = String(formData.get('name') ?? '').trim();
        const result = await createCredentialAction({
          type,
          name,
          username: formData.get('username') ?? undefined,
          appPassword: formData.get('appPassword') ?? undefined,
          apiKey: formData.get('apiKey') ?? undefined,
        });
        if (result.ok) {
          toast.success('Credencial salva com criptografia AES-256-GCM.');
          setFieldErrors({});
          onSuccess({ id: result.data.id, name, type });
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

  return (
    <form action={submit} className="space-y-4">
      <div className="space-y-2">
        <Label>Tipo</Label>
        <Select value={type} onValueChange={(v) => setType(v as CredentialType)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CREDENTIAL_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="cred-name">Nome</Label>
        <Input id="cred-name" name="name" placeholder="ex.: WP deepgames.com.br" required />
        {err('name') ? <p className="text-destructive text-xs">{err('name')}</p> : null}
      </div>
      {type === 'wordpress' ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="cred-username">Usuário do WordPress</Label>
            <Input id="cred-username" name="username" autoComplete="off" required />
            {err('username') ? <p className="text-destructive text-xs">{err('username')}</p> : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="cred-apppass">Application password</Label>
            <Input id="cred-apppass" name="appPassword" type="password" autoComplete="off" required />
            <p className="text-muted-foreground text-xs">
              Gere em Usuários → Perfil → Application Passwords no wp-admin.
            </p>
            {err('appPassword') ? <p className="text-destructive text-xs">{err('appPassword')}</p> : null}
          </div>
        </>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="cred-apikey">API key</Label>
            <Input id="cred-apikey" name="apiKey" type="password" autoComplete="off" required />
            {err('apiKey') ? <p className="text-destructive text-xs">{err('apiKey')}</p> : null}
          </div>
        </>
      )}
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? 'Salvando...' : 'Salvar credencial'}
        </Button>
      </DialogFooter>
    </form>
  );
}
