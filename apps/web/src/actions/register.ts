'use server';

import { hash } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { getDb, subscriptions, users, workspaces } from '@content-pilot/db';
import { z } from 'zod';
import { signIn } from '@/lib/auth';
import type { ActionResult } from '@/lib/action-utils';

const registerSchema = z.object({
  name: z.string().min(2, 'Nome muito curto').max(80),
  email: z.string().email('E-mail inválido').max(200),
  password: z
    .string()
    .min(10, 'Use ao menos 10 caracteres')
    .max(200)
    .refine((p) => /[a-zA-Z]/.test(p) && /[0-9]/.test(p), {
      message: 'Use letras e números',
    }),
  workspaceName: z.string().min(2, 'Nome muito curto').max(80),
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

  const db = getDb();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    return { ok: false, error: 'Já existe uma conta com este e-mail — faça login.' };
  }

  const passwordHash = await hash(data.password, 12);
  const created = await db.transaction(async (tx) => {
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
  if (!created) return { ok: false, error: 'Erro ao criar a conta.' };

  // autentica direto (sem redirect aqui; o client redireciona)
  await signIn('credentials', { email, password: data.password, redirect: false });
  return { ok: true, data: { ok: true } };
}
