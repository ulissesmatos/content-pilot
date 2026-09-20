import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { KeyRound } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { PlatformKeyCard, type ProviderType } from '@/components/admin/platform-key-card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { requireAdmin } from '@/lib/auth';
import { listPlatformCredentials } from '@/lib/platform-secrets';
import { dateTimeFormat } from '@/lib/datetime';

export const metadata = { title: 'Chaves da plataforma' };

const PROVIDERS: Array<{ type: ProviderType; label: string; description: string }> = [
  {
    type: 'openrouter',
    label: 'OpenRouter',
    description: 'Acesso a múltiplos modelos por uma chave só. Devolve o custo real de cada chamada.',
  },
  {
    type: 'openai',
    label: 'OpenAI',
    description: 'Modelos GPT chamados direto na API da OpenAI.',
  },
  {
    type: 'anthropic',
    label: 'Anthropic',
    description: 'Modelos Claude chamados direto na API da Anthropic.',
  },
  {
    type: 'tavily',
    label: 'Tavily',
    description: 'Busca e extração das fontes. Pesa no custo por post tanto quanto o modelo.',
  },
];

export default async function AdminAiKeysPage() {
  const session = await requireAdmin();
  if (!session.isSuperAdmin) redirect('/admin');

  const [rows, locale] = await Promise.all([listPlatformCredentials(), getLocale()]);
  const dateFmt = dateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });
  const byType = new Map(rows.map((r) => [r.type, r]));

  return (
    <>
      <PageHeader
        title="Chaves da plataforma"
        description="Reservadas exclusivamente ao super admin. Guardadas cifradas no cofre e separadas das chaves BYOK."
      />

      <Alert variant="info">
        <KeyRound />
        <AlertTitle>Como a chave é escolhida</AlertTitle>
        <AlertDescription>
          <p>
            Só o workspace do super admin pode usar estas chaves. Por padrão, as chaves BYOK dele
            têm prioridade; o toggle em Credenciais permite optar pelas chaves do sistema. Nenhum
            cliente recebe fallback para elas.
          </p>
        </AlertDescription>
      </Alert>

      <div className="grid gap-6 lg:grid-cols-2">
        {PROVIDERS.map((p) => {
          const row = byType.get(p.type);
          return (
            <PlatformKeyCard
              key={p.type}
              type={p.type}
              label={p.label}
              description={p.description}
              maskedHint={row?.maskedHint ?? null}
              updatedAt={row ? dateFmt.format(row.updatedAt) : null}
            />
          );
        })}
      </div>
    </>
  );
}
