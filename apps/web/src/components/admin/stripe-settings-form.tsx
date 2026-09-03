'use client';

import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { saveStripeSecretsAction, saveStripeSettingsAction } from '@/actions/admin/settings';
import { SecretField, type SecretSource } from '@/components/admin/secret-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function StripeSecretsForm({
  secretKeySource,
  webhookSecretSource,
  maskedHint,
}: {
  secretKeySource: SecretSource;
  webhookSecretSource: SecretSource;
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
        const result = await saveStripeSecretsAction({
          secretKey: formData.get('secretKey'),
          webhookSecret: formData.get('webhookSecret'),
        });
        if (result.ok) {
          toast.success('Chaves do Stripe salvas no cofre.');
          setFieldErrors({});
          (document.getElementById('stripe-secrets') as HTMLFormElement | null)?.reset();
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
        <CardTitle className="text-base">Chaves do Stripe</CardTitle>
        <CardDescription>
          Guardadas cifradas (AES-256-GCM). O valor nunca volta para o navegador — só a máscara.
          As variáveis STRIPE_* do .env continuam valendo como reserva.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form id="stripe-secrets" action={submit} className="space-y-4">
          <SecretField
            id="secretKey"
            label="Chave secreta"
            source={secretKeySource}
            maskedHint={maskedHint}
            description="sk_test_… em desenvolvimento, sk_live_… em produção."
            error={fieldErrors.secretKey?.[0]}
          />
          <SecretField
            id="webhookSecret"
            label="Segredo do webhook"
            source={webhookSecretSource}
            description="whsec_… — gerado ao criar o endpoint no painel do Stripe."
            error={fieldErrors.webhookSecret?.[0]}
          />
          <Button type="submit" disabled={pending}>
            {pending ? 'Salvando...' : 'Salvar chaves'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function StripeAppUrlForm({ appBaseUrl, fallback }: { appBaseUrl: string | null; fallback: string }) {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();
  const submittingRef = useRef(false);

  function submit(formData: FormData) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    startTransition(async () => {
      try {
        const result = await saveStripeSettingsAction({ appBaseUrl: formData.get('appBaseUrl') });
        if (result.ok) {
          toast.success('URL de retorno atualizada.');
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
        <CardTitle className="text-base">URL de retorno</CardTitle>
        <CardDescription>
          Para onde o Stripe devolve o cliente após o checkout e o portal. Em branco usa o AUTH_URL
          do ambiente ({fallback}).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="appBaseUrl">URL base do painel</Label>
            <Input
              id="appBaseUrl"
              name="appBaseUrl"
              defaultValue={appBaseUrl ?? ''}
              placeholder={fallback}
              inputMode="url"
            />
            {fieldErrors.appBaseUrl?.[0] ? (
              <p className="text-destructive text-xs">{fieldErrors.appBaseUrl[0]}</p>
            ) : null}
          </div>
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? 'Salvando...' : 'Salvar URL'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
