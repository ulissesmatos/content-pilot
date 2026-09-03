'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { credentials, getDb, sites } from '@content-pilot/db';
import { z } from 'zod';
import { runAuthedAction, type ActionResult } from '@/lib/action-utils';
import { getWorkspacePlan } from '@/lib/billing';
import { encryptSecret } from '@/lib/vault';

const createCredentialSchema = z
  .object({
    type: z.enum(['wordpress', 'anthropic', 'openai', 'openrouter', 'tavily']),
    name: z.string().min(2, 'Nome muito curto').max(80),
    username: z.string().optional(),
    appPassword: z.string().optional(),
    apiKey: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.type === 'wordpress') {
      if (!val.username?.trim()) ctx.addIssue({ code: 'custom', path: ['username'], message: 'Obrigatório' });
      if (!val.appPassword?.trim()) ctx.addIssue({ code: 'custom', path: ['appPassword'], message: 'Obrigatório' });
    } else if (!val.apiKey?.trim()) {
      ctx.addIssue({ code: 'custom', path: ['apiKey'], message: 'Obrigatório' });
    }
  });

export async function createCredentialAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAuthedAction(createCredentialSchema, input, async (data, { workspaceId, role }) => {
    // Credencial da PLATAFORMA não se cria por aqui: ela vive em /admin/ai/keys,
    // onde a ação é auditada e restrita ao super admin.
    if (data.type !== 'wordpress' && role !== 'admin') {
      // BYOK é recurso de plano: sem ele, o workspace usa as chaves da plataforma.
      const plan = await getWorkspacePlan(workspaceId);
      if (!plan.limits.byokAllowed) {
        throw new Error(
          'Seu plano usa as chaves de IA da plataforma — não precisa configurar nada. Chave própria (BYOK) está disponível no plano Pro.',
        );
      }
    }

    const id = randomUUID();
    const payload =
      data.type === 'wordpress'
        ? { username: data.username!.trim(), appPassword: data.appPassword!.trim() }
        : { apiKey: data.apiKey!.trim() };
    const secretForHint = data.type === 'wordpress' ? data.appPassword! : data.apiKey!;
    const maskedHint = `••••${secretForHint.trim().slice(-4)}`;

    const { ciphertext, keyId } = encryptSecret(payload, workspaceId, id);
    await getDb().insert(credentials).values({
      id,
      workspaceId,
      type: data.type,
      name: data.name.trim(),
      ciphertext,
      keyId,
      maskedHint,
    });

    revalidatePath('/credentials');
    return { id };
  });
}

const deleteSchema = z.object({ id: z.string().uuid() });

export async function deleteCredentialAction(input: unknown): Promise<ActionResult> {
  return runAuthedAction(deleteSchema, input, async ({ id }, { workspaceId }) => {
    const db = getDb();
    const [cred] = await db
      .select({ id: credentials.id, workspaceId: credentials.workspaceId })
      .from(credentials)
      .where(eq(credentials.id, id))
      .limit(1);
    if (!cred) throw new Error('Credencial não encontrada.');

    // Plataforma e outro tenant compartilham a mensagem: nada aqui deve revelar
    // que a linha existe. Chave de plataforma se gerencia em /admin/ai/keys.
    if (cred.workspaceId !== workspaceId) throw new Error('Credencial não encontrada.');

    const [siteUsing] = await db
      .select({ id: sites.id, name: sites.name })
      .from(sites)
      .where(and(eq(sites.credentialId, id), eq(sites.workspaceId, workspaceId)))
      .limit(1);
    if (siteUsing) {
      throw new Error(`Credencial em uso pelo site "${siteUsing.name}" — remova ou troque a credencial do site antes.`);
    }

    await db.delete(credentials).where(and(eq(credentials.id, id), eq(credentials.workspaceId, workspaceId)));
    revalidatePath('/credentials');
    return null;
  });
}
