import { redirect } from 'next/navigation';
import { getDb, getSetting } from '@content-pilot/db';
import { SETTINGS_KEYS, STRIPE_SETTINGS_DEFAULT, stripeSettingsSchema } from '@content-pilot/core';
import { PageHeader } from '@/components/page-header';
import { StripeAppUrlForm, StripeSecretsForm } from '@/components/admin/stripe-settings-form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ShieldAlert } from 'lucide-react';
import { requireAdmin } from '@/lib/auth';
import { getStripeSecrets } from '@/lib/stripe';

export const metadata = { title: 'Configurações da plataforma' };

export default async function AdminSettingsPage() {
  const session = await requireAdmin();
  // Quem tem a chave secreta do Stripe movimenta o dinheiro da operação:
  // admin comum nem vê a tela.
  if (!session.isSuperAdmin) redirect('/admin');

  const [secrets, settings] = await Promise.all([
    getStripeSecrets(),
    getSetting(getDb(), SETTINGS_KEYS.stripe, stripeSettingsSchema, STRIPE_SETTINGS_DEFAULT),
  ]);

  return (
    <>
      <PageHeader
        title="Configurações da plataforma"
        description="Chaves de cobrança e endereços de retorno. Alterações valem em até 30 segundos no worker."
      />

      {secrets.secretKeySource === 'env' || secrets.webhookSecretSource === 'env' ? (
        <Alert variant="info">
          <ShieldAlert />
          <AlertTitle>Usando valores do .env</AlertTitle>
          <AlertDescription>
            <p>
              Salvar aqui move o segredo para o cofre do banco e passa a ter precedência sobre o
              ambiente — a partir daí dá para girar a chave sem novo deploy.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <StripeSecretsForm
          secretKeySource={secrets.secretKeySource}
          webhookSecretSource={secrets.webhookSecretSource}
          maskedHint={secrets.maskedHint}
        />
        <StripeAppUrlForm
          appBaseUrl={settings.appBaseUrl}
          fallback={process.env.AUTH_URL ?? 'http://localhost:3000'}
        />
      </div>
    </>
  );
}
