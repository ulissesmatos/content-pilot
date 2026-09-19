'use client';

import { useState, useTransition } from 'react';
import { MailWarning } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { resendVerificationAction } from '@/actions/email-verification';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * Aviso de e-mail não confirmado. Não bloqueia nada — só existe para que a
 * recuperação de senha tenha para onde ir antes de fazer falta.
 *
 * Só é renderizado quando o envio está configurado: avisar sem ter como
 * reenviar seria pedir uma ação impossível.
 */
export function EmailVerificationNotice({ email }: { email: string }) {
  const t = useTranslations('auth');
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<'idle' | 'sent' | 'error'>('idle');

  return (
    <Alert variant="warning">
      <MailWarning />
      <AlertTitle>{t('unverifiedTitle')}</AlertTitle>
      <AlertDescription>
        <p>{t('unverifiedDescription', { email })}</p>
        {state === 'sent' ? (
          <p className="mt-2 text-sm font-medium">{t('resendDone')}</p>
        ) : (
          <div className="mt-2 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await resendVerificationAction();
                  setState(res.ok ? 'sent' : 'error');
                })
              }
            >
              {t('resendVerification')}
            </Button>
            {state === 'error' ? <span className="text-sm">{t('resendFailed')}</span> : null}
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}
