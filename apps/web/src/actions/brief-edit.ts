'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { runAuthedAction, type ActionResult } from '@/lib/action-utils';
import { MAX_TITLE_LENGTH, saveBriefText, SEO_LIMITS, updateBriefImageSeo } from '@/lib/brief-edit';

const targetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cover') }),
  z.object({ kind: z.literal('inline'), mediaId: z.number().int().positive() }),
]);

const seoSchema = z.object({
  alt: z.string().max(SEO_LIMITS.alt * 2),
  title: z.string().max(SEO_LIMITS.title * 2),
  caption: z.string().max(SEO_LIMITS.caption * 2),
});

const imageSeoSchema = z.object({ id: z.string().uuid(), target: targetSchema, seo: seoSchema });

/** Ajusta só o SEO (alt, título, legenda) de uma imagem do artigo, sem trocar o arquivo. */
export async function updateImageSeoAction(input: unknown): Promise<ActionResult> {
  return runAuthedAction(imageSeoSchema, input, async (data, { workspaceId }) => {
    await updateBriefImageSeo(workspaceId, data.id, { target: data.target, seo: data.seo });
    revalidatePath(`/briefs/${data.id}`);
    return null;
  });
}

const textSchema = z.object({
  id: z.string().uuid(),
  title: z.string().max(MAX_TITLE_LENGTH * 2).optional(),
  edits: z
    .array(
      z.object({
        index: z.number().int().min(0).max(5000),
        beforeText: z.string().max(20_000),
        afterHtml: z.string().max(40_000),
      }),
    )
    .max(500),
});

/** Ajustes básicos no texto do artigo (e no título). Se o WordPress mudou nesse meio tempo, nada é gravado. */
export async function saveTextEditsAction(input: unknown): Promise<ActionResult<{ changed: number; titleChanged: boolean }>> {
  return runAuthedAction(textSchema, input, async (data, { workspaceId }) => {
    const result = await saveBriefText(workspaceId, data.id, { title: data.title, edits: data.edits });
    revalidatePath(`/briefs/${data.id}`);
    revalidatePath('/briefs');
    return result;
  });
}
