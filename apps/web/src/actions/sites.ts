'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { credentials, getDb, sites } from '@content-pilot/db';
import { WordPressAdapter, type WordPressCredentials, type CmsConnectionResult } from '@content-pilot/core';
import { z } from 'zod';
import { isFkViolation, runAuthedAction, type ActionResult } from '@/lib/action-utils';
import { getWorkspacePlan } from '@/lib/billing';
import { decryptSecret } from '@/lib/vault';

const createSiteSchema = z.object({
  name: z.string().min(2, 'Nome muito curto').max(80),
  baseUrl: z
    .string()
    .url('URL inválida')
    .refine((u) => u.startsWith('https://') || u.startsWith('http://localhost'), {
      message: 'Use HTTPS (application passwords do WP exigem HTTPS)',
    }),
  credentialId: z.string().uuid('Selecione uma credencial'),
  defaultLanguage: z.string().min(2).max(10),
});

export async function createSiteAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAuthedAction(createSiteSchema, input, async (data, { workspaceId }) => {
    const db = getDb();

    // limite de sites do plano (Fase 5)
    const plan = await getWorkspacePlan(workspaceId);
    const existing = await db
      .select({ id: sites.id })
      .from(sites)
      .where(eq(sites.workspaceId, workspaceId));
    if (existing.length >= plan.limits.maxSites) {
      throw new Error(
        `Seu plano permite ${plan.limits.maxSites} site(s). Faça upgrade em Plano e cobrança para conectar mais.`,
      );
    }

    const [cred] = await db
      .select({ id: credentials.id, type: credentials.type })
      .from(credentials)
      .where(and(eq(credentials.id, data.credentialId), eq(credentials.workspaceId, workspaceId)))
      .limit(1);
    if (!cred || cred.type !== 'wordpress') {
      throw new Error('Credencial WordPress não encontrada.');
    }

    const [site] = await db
      .insert(sites)
      .values({
        workspaceId,
        name: data.name.trim(),
        baseUrl: data.baseUrl.replace(/\/+$/, ''),
        credentialId: data.credentialId,
        defaultLanguage: data.defaultLanguage,
      })
      .returning({ id: sites.id });

    revalidatePath('/sites');
    return { id: site!.id };
  });
}

const idSchema = z.object({ id: z.string().uuid() });

export async function deleteSiteAction(input: unknown): Promise<ActionResult> {
  return runAuthedAction(idSchema, input, async ({ id }, { workspaceId }) => {
    try {
      await getDb()
        .delete(sites)
        .where(and(eq(sites.id, id), eq(sites.workspaceId, workspaceId)));
    } catch (err) {
      if (isFkViolation(err)) {
        throw new Error('Este site tem jobs, pautas ou autopilots apontando para ele — exclua-os primeiro.');
      }
      throw err;
    }
    revalidatePath('/sites');
    return null;
  });
}

export async function testSiteConnectionAction(input: unknown): Promise<ActionResult<CmsConnectionResult>> {
  return runAuthedAction(idSchema, input, async ({ id }, { workspaceId }) => {
    const db = getDb();
    const [row] = await db
      .select({
        site: sites,
        credCiphertext: credentials.ciphertext,
        credId: credentials.id,
      })
      .from(sites)
      .innerJoin(credentials, eq(sites.credentialId, credentials.id))
      .where(and(eq(sites.id, id), eq(sites.workspaceId, workspaceId)))
      .limit(1);
    if (!row) throw new Error('Site não encontrado.');

    const wpCreds = decryptSecret<WordPressCredentials>(row.credCiphertext, workspaceId, row.credId);
    const adapter = new WordPressAdapter(row.site.baseUrl, wpCreds, { retries: 1, timeoutMs: 20_000 });
    const result = await adapter.testConnection();

    await db
      .update(sites)
      .set({
        status: result.ok ? 'active' : 'error',
        lastCheckedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(sites.id, id));
    await db
      .update(credentials)
      .set({ lastUsedAt: new Date() })
      .where(eq(credentials.id, row.credId));

    revalidatePath('/sites');
    return result;
  });
}
