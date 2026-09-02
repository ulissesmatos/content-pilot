'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Rocket } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { registerAction } from '@/actions/register';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function RegisterPage() {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const input = {
      name: String(form.get('name') ?? ''),
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
      workspaceName: String(form.get('workspaceName') ?? ''),
    };
    startTransition(async () => {
      const res = await registerAction(input);
      if (res.ok) {
        router.push('/');
        router.refresh();
      } else {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
      }
    });
  }

  const fieldError = (name: string) => fieldErrors[name]?.[0];

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
            <CardTitle>{t('registerTitle')}</CardTitle>
            <CardDescription>{t('registerDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">{t('yourName')}</Label>
                <Input id="name" name="name" autoComplete="name" required autoFocus />
                {fieldError('name') ? <p className="text-destructive text-xs">{fieldError('name')}</p> : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="workspaceName">{t('workspaceName')}</Label>
                <Input id="workspaceName" name="workspaceName" placeholder={t('workspacePlaceholder')} required />
                {fieldError('workspaceName') ? (
                  <p className="text-destructive text-xs">{fieldError('workspaceName')}</p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">{t('email')}</Label>
                <Input id="email" name="email" type="email" autoComplete="email" required />
                {fieldError('email') ? <p className="text-destructive text-xs">{fieldError('email')}</p> : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">{t('password')}</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={10}
                  required
                />
                {fieldError('password') ? (
                  <p className="text-destructive text-xs">{fieldError('password')}</p>
                ) : (
                  <p className="text-muted-foreground text-xs">{t('passwordHint')}</p>
                )}
              </div>
              {error ? <p className="text-destructive text-sm">{error}</p> : null}
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                {t('createFreeAccount')}
              </Button>
              <p className="text-muted-foreground text-center text-sm">
                {t('alreadyHaveAccount')}{' '}
                <Link href="/login" className="text-foreground underline-offset-4 hover:underline">
                  {t('signIn')}
                </Link>
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
