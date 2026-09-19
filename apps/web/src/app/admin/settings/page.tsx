import { redirect } from 'next/navigation';
import { getDb, getSetting } from '@content-pilot/db';
import { SETTINGS_KEYS, STRIPE_SETTINGS_DEFAULT, stripeSettingsSchema } from '@content-pilot/core';
import { PageHeader } from '@/components/page-header';
import { EmailSenderForm, ResendKeyForm } from '@/components/admin/email-settings-form';
import { StripeAppUrlForm, StripeSecretsForm } from '@/components/admin/stripe-settings-form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { MailWarning, ShieldAlert } from 'lucide-react';
import { requireAdmin } from '@/lib/auth';
import { getEmailConfig } from '@/lib/email';
import { getStripeSecrets } from '@/lib/stripe';

export const metadata = { title: 'Configurações da plataforma' };

export default async function AdminSettingsPage() {
  const session = await requireAdmin();
  // Quem tem a chave secreta do Stripe movimenta o dinheiro da operação:
  // admin comum nem vê a tela.
  if (!session.isSuperAdmin) redirect('/admin');

  const [secrets, settings, email] = await Promise.all([
    getStripeSecrets(),
    getSetting(getDb(), SETTINGS_KEYS.stripe, stripeSettingsSchema, STRIPE_SETTINGS_DEFAULT),
    getEmailConfig(),
  ]);
  const emailReady = Boolean(email.apiKey && email.from);

  return (
    <>
      <PageHeader
        title="Configurações da plataforma"
        description="E-mail transacional, chaves de cobrança e endereços de retorno. Alterações valem em até 30 segundos no worker."
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

      {!emailReady ? (
        <Alert variant="warning">
          <MailWarning />
          <AlertTitle>Recuperação de senha inativa</AlertTitle>
          <AlertDescription>
            <p>
              Sem chave do Resend e remetente, quem esquecer a senha não tem como voltar sozinho —
              o formulário responde normalmente, mas nenhum e-mail sai. A confirmação de e-mail
              também fica desligada.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <ResendKeyForm apiKeySource={email.apiKeySource} maskedHint={email.maskedHint} />
        <EmailSenderForm
          fromAddress={email.fromSource === 'db' ? email.from : null}
          replyTo={email.replyTo}
          fromSource={email.fromSource}
        />
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
