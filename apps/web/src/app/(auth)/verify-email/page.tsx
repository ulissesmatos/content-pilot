import Link from 'next/link';
import { CheckCircle2, CircleAlert, Rocket } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { confirmEmailToken } from '@/actions/email-verification';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata = { title: 'Confirmar e-mail' };
// O token é de uso único: uma resposta cacheada mostraria "confirmado" para
// quem abrir o link depois, sem nunca ter tocado no banco.
export const dynamic = 'force-dynamic';

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const [t, tc, params] = await Promise.all([
    getTranslations('auth'),
    getTranslations('common'),
    searchParams,
  ]);
  const result = params.token ? await confirmEmailToken(params.token) : 'invalid';
  const ok = result === 'ok';

  return (
    <main className="bg-muted flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center justify-center gap-2">
          <div className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-lg">
            <Rocket className="size-5" />
          </div>
          <span className="text-xl font-semibold">{tc('appName')}</span>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {ok ? (
                <CheckCircle2 className="text-primary size-5" />
              ) : (
                <CircleAlert className="text-muted-foreground size-5" />
              )}
              {ok ? t('verifiedTitle') : t('verifyFailedTitle')}
            </CardTitle>
            <CardDescription>
              {ok ? t('verifiedDescription') : t('verifyFailedDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link href="/">{t('goToDashboard')}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
