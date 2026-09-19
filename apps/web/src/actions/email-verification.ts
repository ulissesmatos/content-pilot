'use server';

import { revalidatePath } from 'next/cache';
import {
  and,
  consumeAuthToken,
  eq,
  getDb,
  isNull,
  issueAuthToken,
  users,
} from '@content-pilot/db';
import { emailVerificationEmail } from '@content-pilot/core';
import { getLocale } from 'next-intl/server';
import { appBaseUrl, emailLocale, trySendEmail } from '@/lib/email';
import { requireSession } from '@/lib/auth';
import { clientIp } from '@/lib/request-context';
import { consumeRateLimit } from '@/lib/rate-limit';
import type { ActionResult } from '@/lib/action-utils';

/**
 * Confirmação de e-mail — informativa, nunca bloqueante.
 *
 * A conta funciona confirmada ou não. O objetivo é saber se a recuperação de
 * senha tem para onde ir ANTES de o usuário precisar dela; travar o cadastro
 * nisso significaria que uma falha do Resend tranca todo mundo para fora.
 */

/** Dispara o e-mail de confirmação. Silencioso: usado no cadastro. */
export async function sendVerificationEmail(opts: {
  userId: string;
  email: string;
  locale: string;
  ip?: string | null;
}): Promise<boolean> {
  try {
    const token = await issueAuthToken(getDb(), { userId: opts.userId, type: 'email_verify', ip: opts.ip });
    const url = `${appBaseUrl()}/verify-email?token=${encodeURIComponent(token)}`;
    return await trySendEmail(
      emailVerificationEmail({
        to: opts.email,
        url,
        locale: emailLocale(opts.locale),
        appName: 'Content Pilot',
      }),
      'email-verify',
    );
  } catch (err) {
    console.error('[email-verify] falha ao emitir token', err);
    return false;
  }
}

/** Reenvio pedido pelo próprio usuário logado. */
export async function resendVerificationAction(): Promise<ActionResult<{ sent: boolean }>> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return { ok: false, error: 'Sessão expirada — faça login novamente.' };
  }
  if (!(await consumeRateLimit('email-verify:user', session.userId))) {
    return { ok: false, error: 'Muitos reenvios. Tente novamente mais tarde.' };
  }

  const [user] = await getDb()
    .select({ emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);
  if (user?.emailVerifiedAt) return { ok: true, data: { sent: false } };

  const sent = await sendVerificationEmail({
    userId: session.userId,
    email: session.email,
    locale: await getLocale(),
    ip: await clientIp().catch(() => null),
  });
  if (!sent) return { ok: false, error: 'Não foi possível enviar agora. Tente novamente mais tarde.' };
  return { ok: true, data: { sent: true } };
}

/** Consome o token do link. Idempotente do ponto de vista do usuário. */
export async function confirmEmailToken(token: string): Promise<'ok' | 'invalid'> {
  const consumed = await consumeAuthToken(getDb(), token, 'email_verify');
  if (!consumed) return 'invalid';
  try {
    await getDb()
      .update(users)
      .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(users.id, consumed.userId), isNull(users.deletedAt)));
    revalidatePath('/');
  } catch (err) {
    console.error('[email-verify] falha ao marcar confirmação', err);
    return 'invalid';
  }
  return 'ok';
}
