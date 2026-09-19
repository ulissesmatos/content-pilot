'use server';

import { hash } from 'bcryptjs';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, subscriptions, users, workspaces } from '@content-pilot/db';
import { after } from 'next/server';
import { getLocale } from 'next-intl/server';
import { z } from 'zod';
import { sendVerificationEmail } from '@/actions/email-verification';
import { isSuperAdmin } from '@/lib/super-admin';
import { signIn } from '@/lib/auth';
import { clientIp } from '@/lib/request-context';
import { consumeRateLimit } from '@/lib/rate-limit';
import type { ActionResult } from '@/lib/action-utils';

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Nome muito curto').max(80),
  email: z.string().trim().email('E-mail inválido').max(200),
  password: z
    .string()
    .min(10, 'Use ao menos 10 caracteres')
    .refine((p) => Buffer.byteLength(p, 'utf8') <= 72, { message: 'Senha deve ter no máximo 72 bytes.' })
    .refine((p) => /[a-zA-Z]/.test(p) && /[0-9]/.test(p), {
      message: 'Use letras e números',
    }),
  workspaceName: z.string().trim().min(2, 'Nome muito curto').max(80),
});

/**
 * Onboarding do cliente SaaS (Fase 5): cria workspace + usuário (role owner)
 * no plano free e já autentica. Público — o rate limit fica no volume de
 * escrita (e-mail único barra duplicatas).
 */
export async function registerAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error);
    return { ok: false, error: 'Dados inválidos.', fieldErrors: flat.fieldErrors as Record<string, string[]> };
  }
  const data = parsed.data;
  const email = data.email.toLowerCase().trim();

  // Endpoint público: sem isto, criar contas em massa é só um loop. Conta
  // depois da validação para não punir quem só errou o preenchimento.
  const ip = await clientIp().catch(() => null);
  if (!await consumeRateLimit('register:ip', ip ?? 'unknown') || !await consumeRateLimit('register:global', 'all')) {
    return { ok: false, error: 'Muitas contas criadas a partir daqui. Tente novamente mais tarde.' };
  }

  if (isSuperAdmin(email)) return { ok: false, error: 'Não foi possível cadastrar este e-mail.' };

  const db = getDb();
  const [existing] = await db.select({ id: users.id }).from(users).where(and(eq(users.email, email), isNull(users.deletedAt))).limit(1);
  if (existing) {
    return { ok: false, error: 'Já existe uma conta com este e-mail — faça login.' };
  }

  const passwordHash = await hash(data.password, 12);
  let created: string;
  try {
    created = await db.transaction(async (tx) => {
      const [ws] = await tx
        .insert(workspaces)
        .values({ name: data.workspaceName.trim() })
        .returning({ id: workspaces.id });
      await tx.insert(users).values({
        workspaceId: ws!.id,
        email,
        passwordHash,
        name: data.name.trim(),
        role: 'owner',
      });
      await tx.insert(subscriptions).values({ workspaceId: ws!.id, plan: 'free', status: 'active' });
      return ws!.id;
    });
  } catch {
    return { ok: false, error: 'Não foi possível criar a conta. Verifique os dados e tente novamente.' };
  }
  if (!created) return { ok: false, error: 'Erro ao criar a conta.' };

  // Confirmação de e-mail é informativa: a conta já está utilizável. Falha de
  // envio não pode derrubar um cadastro que já foi gravado — o usuário
  // reenvia pelo aviso no painel.
  const [newUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)))
    .limit(1);
  if (newUser) {
    // Depois da resposta: o cadastro não deve esperar o round-trip do Resend,
    // que no pior caso soma os retries do cliente HTTP.
    const locale = await getLocale();
    const userId = newUser.id;
    after(() => sendVerificationEmail({ userId, email, locale, ip }).catch(() => false));
  }

  // autentica direto (sem redirect aqui; o client redireciona)
  try {
    await signIn('credentials', { email, password: data.password, redirect: false });
  } catch {
    return { ok: false, error: 'Conta criada. Acesse a página de login para entrar.' };
  }
  return { ok: true, data: { ok: true } };
}
