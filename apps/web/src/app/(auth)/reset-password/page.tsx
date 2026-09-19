'use client';

import { Suspense, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2, Rocket } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { resetPasswordAction } from '@/actions/password-reset';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function ResetForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get('password') ?? '');
    if (password !== String(form.get('confirm') ?? '')) {
      setFieldError(t('passwordsDoNotMatch'));
      return;
    }
    setFieldError(null);
    setError(null);
    startTransition(async () => {
      const res = await resetPasswordAction({ token, password });
      if (res.ok) setDone(true);
      else {
        setError(res.error);
        setFieldError(res.fieldErrors?.password?.[0] ?? null);
      }
    });
  }

  if (!token) {
    return (
      <>
        <CardHeader>
          <CardTitle>{t('resetInvalidTitle')}</CardTitle>
          <CardDescription>{t('resetInvalidDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/forgot-password">{t('forgotSubmit')}</Link>
          </Button>
        </CardContent>
      </>
    );
  }

  if (done) {
    return (
      <>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="text-primary size-5" />
            {t('resetDoneTitle')}
          </CardTitle>
          <CardDescription>{t('resetDoneDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" onClick={() => router.push('/login')}>
            {t('signIn')}
          </Button>
        </CardContent>
      </>
    );
  }

  return (
    <>
      <CardHeader>
        <CardTitle>{t('resetTitle')}</CardTitle>
        <CardDescription>{t('resetDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">{t('newPassword')}</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" required autoFocus />
            <p className="text-muted-foreground text-xs">{t('passwordHint')}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">{t('confirmPassword')}</Label>
            <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
          </div>
          {fieldError ? <p className="text-destructive text-sm">{fieldError}</p> : null}
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {t('resetSubmit')}
          </Button>
          <p className="text-muted-foreground text-center text-sm">
            <Link href="/login" className="text-foreground underline-offset-4 hover:underline">
              {t('backToLogin')}
            </Link>
          </p>
        </form>
      </CardContent>
    </>
  );
}

export default function ResetPasswordPage() {
  const tc = useTranslations('common');
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
          <Suspense fallback={null}>
            <ResetForm />
          </Suspense>
        </Card>
      </div>
    </main>
  );
}
