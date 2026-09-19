'use server';

import { hash } from 'bcryptjs';
import {
  and,
  consumeAuthToken,
  eq,
  getDb,
  isNull,
  issueAuthToken,
  pruneExpiredAuthTokens,
  users,
} from '@content-pilot/db';
import { passwordResetEmail } from '@content-pilot/core';
import { after } from 'next/server';
import { getLocale } from 'next-intl/server';
import { z } from 'zod';
import { appBaseUrl, emailLocale, trySendEmail } from '@/lib/email';
import { clientIp } from '@/lib/request-context';
import { consumeRateLimit } from '@/lib/rate-limit';
import type { ActionResult } from '@/lib/action-utils';

/**
 * Recuperação de senha.
 *
 * Regra que governa este arquivo: a resposta ao navegador é SEMPRE a mesma,
 * exista a conta ou não. E-mail desconhecido, conta banida, Resend fora do ar
 * — tudo devolve o mesmo texto. Qualquer diferença transforma o formulário num
 * verificador de quem tem conta aqui.
 *
 * Isso inclui o TEMPO: o envio vai para `after()`, depois da resposta. Enviar
 * antes faria a conta existente demorar o round-trip do Resend e a inexistente
 * responder na hora — um cronômetro distinguiria as duas sem ler o texto.
 */

const requestSchema = z.object({
  email: z.string().trim().email('E-mail inválido').max(200),
});

export async function requestPasswordResetAction(input: unknown): Promise<ActionResult<{ sent: true }>> {
  const parsed = requestSchema.safeParse(input);
  // Aqui o erro de formato PODE aparecer: não revela nada sobre a conta.
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error);
    return { ok: false, error: 'Dados inválidos.', fieldErrors: flat.fieldErrors as Record<string, string[]> };
  }
  const email = parsed.data.email.toLowerCase().trim();
  const ip = await clientIp().catch(() => null);

  // O limite estourado também devolve sucesso: dizer "muitas tentativas" para
  // um e-mail e nada para outro já é a diferença que queremos evitar.
  const within =
    (await consumeRateLimit('password-reset:ip', ip ?? 'unknown')) &&
    (await consumeRateLimit('password-reset:email', email));

  if (within) {
    try {
      const [user] = await getDb()
        .select({ id: users.id, email: users.email, status: users.status })
        .from(users)
        .where(and(eq(users.email, email), isNull(users.deletedAt)))
        .limit(1);

      // Conta suspensa/banida não recebe link: devolver o acesso a ela seria
      // desfazer a moderação por e-mail.
      if (user && user.status === 'active') {
        const token = await issueAuthToken(getDb(), { userId: user.id, type: 'password_reset', ip });
        const url = `${appBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`;
        const message = passwordResetEmail({
          to: user.email,
          url,
          locale: emailLocale(await getLocale()),
          appName: 'Content Pilot',
        });
        after(() => trySendEmail(message, 'password-reset'));
      }
      after(() => pruneExpiredAuthTokens(getDb()).catch(() => {}));
    } catch (err) {
      // Falha interna não pode virar resposta diferente. Fica no log.
      console.error('[password-reset] falha ao processar pedido', err);
    }
  }

  return { ok: true, data: { sent: true } };
}

const resetSchema = z.object({
  token: z.string().min(10).max(200),
  password: z
    .string()
    .min(10, 'Use ao menos 10 caracteres')
    .refine((p) => Buffer.byteLength(p, 'utf8') <= 72, { message: 'Senha deve ter no máximo 72 bytes.' })
    .refine((p) => /[a-zA-Z]/.test(p) && /[0-9]/.test(p), { message: 'Use letras e números' }),
});

/**
 * Troca a senha e derruba as sessões antigas.
 *
 * `sessionsValidFrom` é o que faz a troca valer alguma coisa: o next-auth usa
 * JWT, então não há linha de sessão para apagar — sem este carimbo, quem
 * estava dentro continuaria dentro depois da troca.
 */
export async function resetPasswordAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error);
    return { ok: false, error: 'Dados inválidos.', fieldErrors: flat.fieldErrors as Record<string, string[]> };
  }

  const consumed = await consumeAuthToken(getDb(), parsed.data.token, 'password_reset');
  if (!consumed) {
    return {
      ok: false,
      error: 'Este link expirou ou já foi usado. Peça um novo.',
      code: 'token.invalid',
    };
  }

  try {
    const passwordHash = await hash(parsed.data.password, 12);
    const now = new Date();
    const updated = await getDb()
      .update(users)
      .set({
        passwordHash,
        sessionsValidFrom: now,
        // quem provou ter a caixa de entrada confirmou o e-mail por tabela
        emailVerifiedAt: now,
        updatedAt: now,
      })
      .where(and(eq(users.id, consumed.userId), isNull(users.deletedAt)))
      .returning({ id: users.id });
    if (!updated[0]) return { ok: false, error: 'Conta indisponível. Fale com o suporte.' };
  } catch (err) {
    console.error('[password-reset] falha ao gravar a nova senha', err);
    return { ok: false, error: 'Não foi possível concluir. Tente novamente.' };
  }

  return { ok: true, data: { ok: true } };
}
