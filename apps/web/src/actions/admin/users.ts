'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { users } from '@content-pilot/db';
import { z } from 'zod';
import { runAdminAction } from '@/lib/admin-action';
import { invalidateUserCache } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/super-admin';
import { UserFacingError } from '@/lib/errors';
import type { ActionResult } from '@/lib/action-utils';

const setStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['active', 'suspended', 'banned']),
  reason: z.string().max(500).optional(),
});

/**
 * Bloqueia/desbloqueia uma conta.
 *
 * Os invariantes são checados AQUI, no servidor, não na UI: a UI também
 * desabilita o botão, mas isso é cortesia visual, não controle de acesso.
 */
export async function setUserStatusAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAdminAction(
    setStatusSchema,
    input,
    { action: 'user.setStatus', targetType: 'user' },
    async (data, { tx, session, audit }) => {
      const [target] = await tx
        .select({
          id: users.id,
          email: users.email,
          status: users.status,
          workspaceId: users.workspaceId,
          deletedAt: users.deletedAt,
        })
        .from(users)
        .where(eq(users.id, data.id))
        .limit(1);

      // "não existe" e "excluído" compartilham a mensagem de propósito
      if (!target || target.deletedAt) throw new UserFacingError('Usuário não encontrado.');

      if (isSuperAdmin(target.email)) {
        throw new UserFacingError('O super administrador não pode ser bloqueado.');
      }
      if (target.id === session.userId) {
        throw new UserFacingError('Você não pode alterar o status da própria conta.');
      }
      if (target.status === data.status) {
        throw new UserFacingError('A conta já está nesse estado.');
      }

      const reason = data.reason?.trim() || null;
      await tx
        .update(users)
        .set({
          status: data.status,
          statusReason: data.status === 'active' ? null : reason,
          statusChangedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, target.id));

      audit({
        targetId: target.id,
        workspaceId: target.workspaceId,
        diff: {
          email: target.email,
          before: { status: target.status },
          after: { status: data.status, reason },
        },
      });

      // a sessão do alvo revalida em até 60s; isto faz valer na hora
      invalidateUserCache(target.id);
      revalidatePath('/admin/users');
      revalidatePath('/admin');
      revalidatePath('/admin/audit');
      return { id: target.id };
    },
  );
}
