'use server';

import { UserFacingError } from '@/lib/errors';
import { revalidatePath } from 'next/cache';
import { and, briefs, eq, getTenantDb, runs, sites } from '@content-pilot/db';
import { jobLlmConfigSchema } from '@content-pilot/core';
import { z } from 'zod';
import { runAuthedAction, type ActionResult } from '@/lib/action-utils';
import { assertWorkspaceReady, getWorkspaceReadiness } from '@/lib/readiness';
import { getBoss } from '@/lib/boss';
import { assertTemplateAccessible } from '@/lib/tenant';
import { getWordPressForSite } from '@/lib/wp';

const createBriefSchema = z.object({
  topic: z.string().min(3, 'Tópico muito curto').max(200),
  siteId: z.string().uuid('Selecione um site'),
  templateId: z.string().uuid('Selecione um template'),
  language: z.string().min(2).max(10).default('pt-BR'),
  keywords: z.string().default(''),
  targetCategoryWpId: z
    .string()
    .default('')
    .transform((v) => {
      const n = Number.parseInt(v.trim(), 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    }),
  extraInstructions: z.string().max(2000).default(''),
  publishMode: z.enum(['draft', 'publish']).default('draft'),
});

async function enqueueBriefGeneration(briefId: string, workspaceId: string): Promise<string> {
  const db = getTenantDb(workspaceId);
  const [run] = await db
    .insert(runs)
    .values({ workspaceId, briefId, kind: 'create', trigger: 'manual', status: 'running' })
    .returning({ id: runs.id });

  const boss = await getBoss();
  const sent = await boss.send(
    'brief.generate',
    { briefId, runId: run!.id },
    { singletonKey: briefId, retryLimit: 1, retryDelay: 120, expireInSeconds: 900 },
  );
  if (!sent) {
    await db
      .update(runs)
      .set({ status: 'cancelled', finishedAt: new Date(), error: 'geração anterior ainda em andamento' })
      .where(eq(runs.id, run!.id));
    throw new UserFacingError('Esta pauta já está sendo gerada.');
  }
  return run!.id;
}

export async function createBriefAction(input: unknown): Promise<ActionResult<{ id: string; runId: string }>> {
  return runAuthedAction(createBriefSchema, input, async (data, { workspaceId, email }) => {
    await assertWorkspaceReady(workspaceId, email);
    const db = getTenantDb(workspaceId);
    const [site] = await db
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.id, data.siteId), eq(sites.workspaceId, workspaceId)))
      .limit(1);
    if (!site) throw new UserFacingError('Site não encontrado.');
    await assertTemplateAccessible(data.templateId, workspaceId);

    // O modelo vem do perfil do admin (model_profiles); a config guarda só
    // o que ainda é do cliente.
    const keywords = data.keywords
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const [brief] = await db
      .insert(briefs)
      .values({
        workspaceId,
        siteId: data.siteId,
        templateId: data.templateId,
        topic: data.topic.trim(),
        keywords,
        language: data.language,
        targetCategoryWpId: data.targetCategoryWpId,
        extraInstructions: data.extraInstructions.trim() || null,
        publishMode: data.publishMode,
        status: 'queued',
        llmConfig: jobLlmConfigSchema.parse({}),
      })
      .returning({ id: briefs.id });

    const runId = await enqueueBriefGeneration(brief!.id, workspaceId);
    revalidatePath('/briefs');
    return { id: brief!.id, runId };
  });
}

const idSchema = z.object({ id: z.string().uuid() });

const updateBriefSchema = createBriefSchema.omit({ siteId: true, templateId: true }).extend({ id: z.string().uuid() });

/**
 * Edita uma pauta que ainda não virou post (pending/failed). Site e template
 * não mudam — para isso, exclua e crie outra.
 */
export async function updateBriefAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAuthedAction(updateBriefSchema, input, async (data, { workspaceId }) => {
    const db = getTenantDb(workspaceId);
    const [brief] = await db
      .select()
      .from(briefs)
      .where(and(eq(briefs.id, data.id), eq(briefs.workspaceId, workspaceId)))
      .limit(1);
    if (!brief) throw new UserFacingError('Pauta não encontrada.');
    if (brief.status !== 'pending' && brief.status !== 'failed') {
      throw new UserFacingError('Só pautas pendentes ou com falha podem ser editadas — depois de gerado, edite o post no WordPress.');
    }

    // O modelo vem do perfil do admin (model_profiles); a config guarda só
    // o que ainda é do cliente.
    const existingLlm = (brief.llmConfig ?? {}) as { tokenBudget?: number };
    const keywords = data.keywords
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    await db
      .update(briefs)
      .set({
        topic: data.topic.trim(),
        keywords,
        language: data.language,
        targetCategoryWpId: data.targetCategoryWpId,
        extraInstructions: data.extraInstructions.trim() || null,
        publishMode: data.publishMode,
        llmConfig: jobLlmConfigSchema.parse({
          tokenBudget: existingLlm.tokenBudget,
        }),
        updatedAt: new Date(),
      })
      .where(eq(briefs.id, data.id));

    revalidatePath('/briefs');
    return { id: data.id };
  });
}

/** Regera uma pauta que falhou (pautas com post criado não regeram — evita duplicar posts no WP). */
export async function regenerateBriefAction(input: unknown): Promise<ActionResult<{ runId: string }>> {
  return runAuthedAction(idSchema, input, async ({ id }, { workspaceId, email }) => {
    await assertWorkspaceReady(workspaceId, email);
    const db = getTenantDb(workspaceId);
    const [brief] = await db
      .select()
      .from(briefs)
      .where(and(eq(briefs.id, id), eq(briefs.workspaceId, workspaceId)))
      .limit(1);
    if (!brief) throw new UserFacingError('Pauta não encontrada.');
    if (brief.status !== 'failed') {
      throw new UserFacingError('Só pautas com falha podem ser regeradas. Para refazer um post já criado, exclua o rascunho no WordPress e crie uma nova pauta.');
    }

    await db.update(briefs).set({ status: 'queued', error: null, updatedAt: new Date() }).where(eq(briefs.id, id));
    const runId = await enqueueBriefGeneration(id, workspaceId);
    revalidatePath('/briefs');
    return { runId };
  });
}

/** Publica no WordPress um rascunho gerado (ready_for_review → published). */
export async function publishBriefAction(input: unknown): Promise<ActionResult> {
  return runAuthedAction(idSchema, input, async ({ id }, { workspaceId }) => {
    const db = getTenantDb(workspaceId);
    const [brief] = await db
      .select()
      .from(briefs)
      .where(and(eq(briefs.id, id), eq(briefs.workspaceId, workspaceId)))
      .limit(1);
    if (!brief) throw new UserFacingError('Pauta não encontrada.');
    if (brief.status !== 'ready_for_review' || !brief.createdWpPostId) {
      throw new UserFacingError('Esta pauta não tem rascunho aguardando publicação.');
    }

    const wp = await getWordPressForSite(workspaceId, brief.siteId);
    await wp.updatePost(brief.createdWpPostId, { status: 'publish' });

    await db.update(briefs).set({ status: 'published', updatedAt: new Date() }).where(eq(briefs.id, id));
    revalidatePath('/briefs');
    revalidatePath(`/briefs/${id}`);
    return null;
  });
}

const regenerateImageSchema = z.object({
  id: z.string().uuid(),
  /** 'cover' ou 'inline-N': o slot do relatório de imagens. */
  slotId: z.string().regex(/^(cover|inline-\d{1,2})$/),
  instruction: z.string().trim().max(500).default(''),
});

/**
 * Gera de novo, com IA, uma imagem de um artigo já criado (ou a capa que faltou).
 * Vai para o worker, que gera, converte, envia ao WordPress e troca no post.
 */
export async function regenerateImageAction(input: unknown): Promise<ActionResult<{ runId: string }>> {
  return runAuthedAction(regenerateImageSchema, input, async (data, { workspaceId, email }) => {
    const readiness = await getWorkspaceReadiness(workspaceId, email);
    if (readiness.issues.some((i) => i.code === 'no-image-generator')) {
      throw new UserFacingError('Ative a geração de imagem por IA (chave OpenAI e modelo de imagem) para gerar de novo.');
    }

    const db = getTenantDb(workspaceId);
    const [brief] = await db
      .select({ id: briefs.id, status: briefs.status, createdWpPostId: briefs.createdWpPostId })
      .from(briefs)
      .where(and(eq(briefs.id, data.id), eq(briefs.workspaceId, workspaceId)))
      .limit(1);
    if (!brief) throw new UserFacingError('Pauta não encontrada.');
    if ((brief.status !== 'ready_for_review' && brief.status !== 'published') || !brief.createdWpPostId) {
      throw new UserFacingError('O artigo precisa estar criado no WordPress para trocar uma imagem.');
    }

    const [run] = await db
      .insert(runs)
      .values({ workspaceId, briefId: data.id, kind: 'update', trigger: 'manual', status: 'running' })
      .returning({ id: runs.id });

    const boss = await getBoss();
    // uma troca por artigo por vez: duas em paralelo leriam o mesmo HTML e uma apagaria a outra
    const sent = await boss.send(
      'image.regenerate',
      { briefId: data.id, runId: run!.id, slotId: data.slotId, instruction: data.instruction || undefined },
      { singletonKey: `img:${data.id}`, retryLimit: 0, expireInSeconds: 600 },
    );
    if (!sent) {
      await db
        .update(runs)
        .set({ status: 'cancelled', finishedAt: new Date(), error: 'já há uma imagem sendo gerada para este artigo' })
        .where(eq(runs.id, run!.id));
      throw new UserFacingError('Já há uma imagem sendo gerada para este artigo. Aguarde terminar.');
    }
    return { runId: run!.id };
  });
}

export async function deleteBriefAction(input: unknown): Promise<ActionResult> {
  return runAuthedAction(idSchema, input, async ({ id }, { workspaceId }) => {
    const db = getTenantDb(workspaceId);
    const [generating] = await db
      .select({ status: briefs.status })
      .from(briefs)
      .where(and(eq(briefs.id, id), eq(briefs.workspaceId, workspaceId)))
      .limit(1);
    if (!generating) throw new UserFacingError('Pauta não encontrada.');
    if (generating.status === 'generating' || generating.status === 'queued') {
      throw new UserFacingError('Aguarde a geração terminar (ou pare a execução) antes de excluir.');
    }
    // O histórico de execuções é preservado (runs.brief_id vira NULL); o post no WP não é afetado.
    await db.delete(briefs).where(and(eq(briefs.id, id), eq(briefs.workspaceId, workspaceId)));
    revalidatePath('/briefs');
    revalidatePath('/runs');
    return null;
  });
}
