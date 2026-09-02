'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Loader2, Rocket } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { loginAction } from '@/actions/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function LoginPage() {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const [error, formAction, pending] = useActionState(loginAction, undefined);

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
            <CardTitle>{t('loginTitle')}</CardTitle>
            <CardDescription>{t('loginDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={formAction} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">{t('email')}</Label>
                <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">{t('password')}</Label>
                <Input id="password" name="password" type="password" autoComplete="current-password" required />
              </div>
              {error ? <p className="text-destructive text-sm">{t('invalidCredentials')}</p> : null}
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                {t('signIn')}
              </Button>
              <p className="text-muted-foreground text-center text-sm">
                {t('noAccount')}{' '}
                <Link href="/register" className="text-foreground underline-offset-4 hover:underline">
                  {t('createFreeAccount')}
                </Link>
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
