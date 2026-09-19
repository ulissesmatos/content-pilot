'use client';

import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { saveEmailSettingsAction, saveResendKeyAction } from '@/actions/admin/settings';
import { SecretField, type SecretSource } from '@/components/admin/secret-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function ResendKeyForm({
  apiKeySource,
  maskedHint,
}: {
  apiKeySource: SecretSource;
  maskedHint: string | null;
}) {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();
  const submittingRef = useRef(false);

  function submit(formData: FormData) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    startTransition(async () => {
      try {
        const result = await saveResendKeyAction({ apiKey: formData.get('apiKey') });
        if (result.ok) {
          toast.success('Chave do Resend salva no cofre.');
          setFieldErrors({});
          (document.getElementById('resend-key') as HTMLFormElement | null)?.reset();
        } else {
          setFieldErrors(result.fieldErrors ?? {});
          toast.error(result.error);
        }
      } finally {
        submittingRef.current = false;
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Chave do Resend</CardTitle>
        <CardDescription>
          Usada na recuperação de senha e na confirmação de e-mail. Guardada cifrada
          (AES-256-GCM); o valor nunca volta ao navegador. RESEND_API_KEY do .env vale como reserva.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form id="resend-key" action={submit} className="space-y-4">
          <SecretField
            id="apiKey"
            label="API key"
            source={apiKeySource}
            maskedHint={maskedHint}
            description="re_… — crie em resend.com/api-keys com permissão de envio."
            error={fieldErrors.apiKey?.[0]}
          />
          <Button type="submit" disabled={pending}>
            {pending ? 'Salvando...' : 'Salvar chave'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function EmailSenderForm({
  fromAddress,
  replyTo,
  fromSource,
}: {
  fromAddress: string | null;
  replyTo: string | null;
  fromSource: SecretSource;
}) {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();
  const submittingRef = useRef(false);

  function submit(formData: FormData) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    startTransition(async () => {
      try {
        const result = await saveEmailSettingsAction({
          fromAddress: formData.get('fromAddress'),
          replyTo: formData.get('replyTo'),
        });
        if (result.ok) {
          toast.success('Remetente atualizado.');
          setFieldErrors({});
        } else {
          setFieldErrors(result.fieldErrors ?? {});
          toast.error(result.error);
        }
      } finally {
        submittingRef.current = false;
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Remetente</CardTitle>
        <CardDescription>
          O domínio precisa estar verificado no Resend — sem isso a chave é aceita e o envio é
          recusado. {fromSource === 'env' ? 'Hoje vindo do EMAIL_FROM do ambiente.' : null}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fromAddress">Endereço de envio</Label>
            <Input
              id="fromAddress"
              name="fromAddress"
              defaultValue={fromAddress ?? ''}
              placeholder="Content Pilot <no-reply@seudominio.com>"
            />
            {fieldErrors.fromAddress?.[0] ? (
              <p className="text-destructive text-xs">{fieldErrors.fromAddress[0]}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="replyTo">Responder para (opcional)</Label>
            <Input
              id="replyTo"
              name="replyTo"
              defaultValue={replyTo ?? ''}
              placeholder="suporte@seudominio.com"
            />
            {fieldErrors.replyTo?.[0] ? (
              <p className="text-destructive text-xs">{fieldErrors.replyTo[0]}</p>
            ) : null}
          </div>
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? 'Salvando...' : 'Salvar remetente'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
