'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Loader2, MailCheck, Rocket } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { requestPasswordResetAction } from '@/actions/password-reset';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * A tela de sucesso é a mesma para e-mail existente ou não — é o que impede
 * usar este formulário para descobrir quem tem conta aqui.
 */
export default function ForgotPasswordPage() {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get('email') ?? '');
    startTransition(async () => {
      const res = await requestPasswordResetAction({ email });
      if (res.ok) setSent(true);
      else setFieldError(res.fieldErrors?.email?.[0] ?? res.error);
    });
  }

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
          {sent ? (
            <>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MailCheck className="text-primary size-5" />
                  {t('forgotSentTitle')}
                </CardTitle>
                <CardDescription>{t('forgotSentDescription')}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild variant="outline" className="w-full">
                  <Link href="/login">{t('backToLogin')}</Link>
                </Button>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader>
                <CardTitle>{t('forgotTitle')}</CardTitle>
                <CardDescription>{t('forgotDescription')}</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={onSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">{t('email')}</Label>
                    <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
                    {fieldError ? <p className="text-destructive text-sm">{fieldError}</p> : null}
                  </div>
                  <Button type="submit" className="w-full" disabled={pending}>
                    {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                    {t('forgotSubmit')}
                  </Button>
                  <p className="text-muted-foreground text-center text-sm">
                    <Link href="/login" className="text-foreground underline-offset-4 hover:underline">
                      {t('backToLogin')}
                    </Link>
                  </p>
                </form>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </main>
  );
}
