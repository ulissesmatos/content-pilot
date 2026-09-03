'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull } from 'drizzle-orm';
import { credentials } from '@content-pilot/db';
import { bumpConfigVersion } from '@content-pilot/db';
import { z } from 'zod';
import { runAdminAction } from '@/lib/admin-action';
import { upsertPlatformCredential } from '@/lib/platform-secrets';
import { UserFacingError } from '@/lib/errors';
import type { ActionResult } from '@/lib/action-utils';

/**
 * Chaves de IA/busca da plataforma: o fallback usado por todo workspace que
 * não traz chave própria (ver a cascata em apps/worker/src/lib/resolve.ts).
 */
const PROVIDER_TYPES = ['openai', 'openrouter', 'anthropic', 'tavily'] as const;

const PROVIDER_LABEL: Record<(typeof PROVIDER_TYPES)[number], string> = {
  openai: 'OpenAI (plataforma)',
  openrouter: 'OpenRouter (plataforma)',
  anthropic: 'Anthropic (plataforma)',
  tavily: 'Tavily (plataforma)',
};

const saveKeySchema = z.object({
  type: z.enum(PROVIDER_TYPES),
  // sem regex por provedor: os formatos mudam com frequência e um padrão
  // desatualizado bloquearia uma chave válida
  apiKey: z.string().min(8, 'Chave muito curta').max(300),
});

export async function savePlatformKeyAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAdminAction(
    saveKeySchema,
    input,
    { action: 'settings.platformKey.save', targetType: 'credential', superAdminOnly: true },
    async (data, { tx, audit }) => {
      const result = await upsertPlatformCredential(tx, {
        type: data.type,
        name: PROVIDER_LABEL[data.type],
        patch: { apiKey: data.apiKey },
        hintField: 'apiKey',
      });
      audit({
        targetId: result.id,
        diff: { provider: data.type, created: result.created, updatedFields: ['apiKey'] },
      });
      revalidatePath('/admin/ai/keys');
      return { id: result.id };
    },
  );
}

const deleteKeySchema = z.object({ type: z.enum(PROVIDER_TYPES) });

export async function deletePlatformKeyAction(input: unknown): Promise<ActionResult<null>> {
  return runAdminAction(
    deleteKeySchema,
    input,
    { action: 'settings.platformKey.delete', targetType: 'credential', superAdminOnly: true },
    async (data, { tx, audit }) => {
      const [row] = await tx
        .select({ id: credentials.id, maskedHint: credentials.maskedHint })
        .from(credentials)
        .where(and(isNull(credentials.workspaceId), eq(credentials.type, data.type)))
        .limit(1);
      if (!row) throw new UserFacingError('Nenhuma chave da plataforma para este provedor.');

      await tx.delete(credentials).where(eq(credentials.id, row.id));
      // o cache guarda o segredo decifrado: sem isto o worker seguiria usando
      // a chave apagada por até 30s
      await bumpConfigVersion(tx);

      audit({ targetId: row.id, diff: { provider: data.type, maskedHint: row.maskedHint } });
      revalidatePath('/admin/ai/keys');
      return null;
    },
  );
}
