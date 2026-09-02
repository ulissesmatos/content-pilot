'use server';

import { revalidatePath } from 'next/cache';
import { and, contentJobs, contentTemplates, eq, getDb, isNull, or } from '@content-pilot/db';
import { parseTemplateConfig } from '@content-pilot/core';
import { z } from 'zod';
import { isFkViolation, runAuthedAction, type ActionResult } from '@/lib/action-utils';

const idSchema = z.object({ id: z.string().uuid() });

const cloneTemplateSchema = z.object({
  id: z.string().uuid(),
  /** Nome customizado (ex.: criação rápida a partir do modal de job). Default: "<origem> (cópia)". */
  name: z.string().min(2, 'Nome muito curto').max(80).optional(),
});

/** Clona um template (builtin ou próprio) para o workspace, liberando edição. */
export async function cloneTemplateAction(input: unknown): Promise<ActionResult<{ id: string; name: string }>> {
  return runAuthedAction(cloneTemplateSchema, input, async ({ id, name }, { workspaceId }) => {
    const db = getDb();
    const [source] = await db
      .select()
      .from(contentTemplates)
      .where(
        and(
          eq(contentTemplates.id, id),
          or(isNull(contentTemplates.workspaceId), eq(contentTemplates.workspaceId, workspaceId)),
        ),
      )
      .limit(1);
    if (!source) throw new Error('Template não encontrado.');

    // slug único no workspace: acrescenta sufixo incremental
    const baseSlug = `${source.slug}-copia`;
    const existing = await db
      .select({ slug: contentTemplates.slug })
      .from(contentTemplates)
      .where(eq(contentTemplates.workspaceId, workspaceId));
    const taken = new Set(existing.map((t) => t.slug));
    let slug = baseSlug;
    for (let i = 2; taken.has(slug); i++) slug = `${baseSlug}-${i}`;

    const finalName = name?.trim() || `${source.name} (cópia)`;

    const [clone] = await db
      .insert(contentTemplates)
      .values({
        workspaceId,
        slug,
        name: finalName,
        description: source.description,
        config: source.config,
        isBuiltin: false,
      })
      .returning({ id: contentTemplates.id });

    revalidatePath('/templates');
    return { id: clone!.id, name: finalName };
  });
}

const updateTemplateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(2).max(80),
  description: z.string().max(500).default(''),
  /** Config completo em JSON — validado pelo zod do core antes de salvar. */
  configJson: z.string().min(2),
});

export async function updateTemplateAction(input: unknown): Promise<ActionResult> {
  return runAuthedAction(updateTemplateSchema, input, async (data, { workspaceId }) => {
    const db = getDb();
    const [existing] = await db
      .select({ id: contentTemplates.id, isBuiltin: contentTemplates.isBuiltin, version: contentTemplates.version })
      .from(contentTemplates)
      .where(and(eq(contentTemplates.id, data.id), eq(contentTemplates.workspaceId, workspaceId)))
      .limit(1);
    if (!existing) throw new Error('Template não encontrado.');
    if (existing.isBuiltin) throw new Error('Templates builtin são somente leitura — clone para editar.');

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(data.configJson);
    } catch (err) {
      throw new Error(`JSON inválido: ${err instanceof Error ? err.message : 'erro de sintaxe'}`);
    }

    let config;
    try {
      config = parseTemplateConfig(parsedJson);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Config não passou na validação: ${msg.slice(0, 800)}`);
    }

    await db
      .update(contentTemplates)
      .set({
        name: data.name.trim(),
        description: data.description.trim() || null,
        config,
        version: existing.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(contentTemplates.id, data.id));

    revalidatePath('/templates');
    revalidatePath(`/templates/${data.id}`);
    return null;
  });
}

export async function deleteTemplateAction(input: unknown): Promise<ActionResult> {
  return runAuthedAction(idSchema, input, async ({ id }, { workspaceId }) => {
    const db = getDb();
    const [jobUsing] = await db
      .select({ id: contentJobs.id, name: contentJobs.name })
      .from(contentJobs)
      .where(and(eq(contentJobs.templateId, id), eq(contentJobs.workspaceId, workspaceId)))
      .limit(1);
    if (jobUsing) {
      throw new Error(`Template em uso pelo job "${jobUsing.name}" — troque o template do job antes de excluir.`);
    }

    let deleted;
    try {
      [deleted] = await db
        .delete(contentTemplates)
        .where(
          and(
            eq(contentTemplates.id, id),
            eq(contentTemplates.workspaceId, workspaceId),
            eq(contentTemplates.isBuiltin, false),
          ),
        )
        .returning({ id: contentTemplates.id });
    } catch (err) {
      if (isFkViolation(err)) {
        throw new Error('Template em uso por pautas ou autopilots — troque o template deles antes de excluir.');
      }
      throw err;
    }
    if (!deleted) throw new Error('Template não encontrado ou é builtin (somente leitura).');

    revalidatePath('/templates');
    return null;
  });
}
