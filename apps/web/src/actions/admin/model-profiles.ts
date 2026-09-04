'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { modelCatalog, modelProfileEntries, modelProfiles } from '@content-pilot/db';
import { LLM_PURPOSES, VISION_PURPOSES } from '@content-pilot/core';
import { z } from 'zod';
import { runAdminAction } from '@/lib/admin-action';
import { UserFacingError } from '@/lib/errors';
import type { ActionResult } from '@/lib/action-utils';

const setEntrySchema = z.object({
  profileId: z.string().uuid(),
  purpose: z.enum(LLM_PURPOSES),
  provider: z.enum(['anthropic', 'openai', 'openrouter']),
  modelId: z.string().min(1).max(200),
  maxTokens: z.coerce.number().int().positive().max(200_000).optional(),
});

/**
 * Define o modelo de uma etapa do perfil.
 *
 * A checagem de visão é a razão principal desta ação existir: `illustrate`
 * manda imagem ao modelo, e um modelo sem visão não falha — ele responde
 * qualquer coisa e o post sai sem capa, em silêncio. Melhor recusar o salvamento.
 */
export async function setProfileEntryAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAdminAction(
    setEntrySchema,
    input,
    { action: 'modelProfile.setEntry', targetType: 'model_profile', superAdminOnly: true },
    async (data, { tx, audit }) => {
      const [profile] = await tx
        .select({ id: modelProfiles.id, slug: modelProfiles.slug })
        .from(modelProfiles)
        .where(eq(modelProfiles.id, data.profileId))
        .limit(1);
      if (!profile) throw new UserFacingError('Perfil não encontrado.');

      const [catalogEntry] = await tx
        .select({
          supportsVision: modelCatalog.supportsVision,
          displayName: modelCatalog.displayName,
        })
        .from(modelCatalog)
        .where(
          and(eq(modelCatalog.provider, data.provider), eq(modelCatalog.modelId, data.modelId)),
        )
        .limit(1);

      if (VISION_PURPOSES.has(data.purpose)) {
        if (!catalogEntry) {
          throw new UserFacingError(
            'Este modelo não está no catálogo, então não dá para confirmar que aceita imagem. Sincronize o catálogo e escolha da lista.',
          );
        }
        if (!catalogEntry.supportsVision) {
          throw new UserFacingError(
            `"${catalogEntry.displayName}" não aceita imagem. Sem visão, a escolha da capa falha em silêncio e todo post sai sem imagem.`,
          );
        }
      }

      const [before] = await tx
        .select({ provider: modelProfileEntries.provider, modelId: modelProfileEntries.modelId })
        .from(modelProfileEntries)
        .where(
          and(
            eq(modelProfileEntries.profileId, profile.id),
            eq(modelProfileEntries.purpose, data.purpose),
          ),
        )
        .limit(1);

      await tx
        .insert(modelProfileEntries)
        .values({
          profileId: profile.id,
          purpose: data.purpose,
          provider: data.provider,
          modelId: data.modelId,
          maxTokens: data.maxTokens ?? null,
        })
        .onConflictDoUpdate({
          target: [modelProfileEntries.profileId, modelProfileEntries.purpose],
          set: {
            provider: data.provider,
            modelId: data.modelId,
            maxTokens: data.maxTokens ?? null,
            updatedAt: new Date(),
          },
        });

      audit({
        targetId: profile.id,
        diff: {
          profile: profile.slug,
          purpose: data.purpose,
          before: before ?? null,
          after: { provider: data.provider, modelId: data.modelId },
        },
      });

      revalidatePath('/admin/ai/profiles');
      return { id: profile.id };
    },
  );
}

const setDefaultSchema = z.object({ profileId: z.string().uuid() });

/** Perfil usado por quem não tem plano apontando para outro. */
export async function setDefaultProfileAction(input: unknown): Promise<ActionResult<null>> {
  return runAdminAction(
    setDefaultSchema,
    input,
    { action: 'modelProfile.setDefault', targetType: 'model_profile', superAdminOnly: true },
    async (data, { tx, audit }) => {
      const [profile] = await tx
        .select({ id: modelProfiles.id, slug: modelProfiles.slug })
        .from(modelProfiles)
        .where(eq(modelProfiles.id, data.profileId))
        .limit(1);
      if (!profile) throw new UserFacingError('Perfil não encontrado.');

      const missing = await tx
        .select({ purpose: modelProfileEntries.purpose })
        .from(modelProfileEntries)
        .where(eq(modelProfileEntries.profileId, profile.id));
      const have = new Set(missing.map((m) => m.purpose));
      const faltando = LLM_PURPOSES.filter((p) => !have.has(p));
      if (faltando.length > 0) {
        // um default incompleto derruba a execução na etapa que faltar
        throw new UserFacingError(
          `Defina o modelo de todas as etapas antes de tornar padrão. Faltam: ${faltando.join(', ')}.`,
        );
      }

      await tx.update(modelProfiles).set({ isDefault: false, updatedAt: new Date() });
      await tx
        .update(modelProfiles)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(eq(modelProfiles.id, profile.id));

      audit({ targetId: profile.id, diff: { after: { isDefault: profile.slug } } });
      revalidatePath('/admin/ai/profiles');
      return null;
    },
  );
}
