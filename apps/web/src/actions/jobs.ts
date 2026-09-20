'use server';

import { UserFacingError } from '@/lib/errors';
import { revalidatePath } from 'next/cache';
import { and, contentJobs, eq, getTenantDb, runs, sites } from '@content-pilot/db';
import { jobLimitsSchema, jobLlmConfigSchema, nextRunAt as computeNextRunAt, postFilterSchema } from '@content-pilot/core';
import { z } from 'zod';
import { runAuthedAction, type ActionResult } from '@/lib/action-utils';
import { assertWorkspaceReady } from '@/lib/readiness';
import { getBoss } from '@/lib/boss';
import { assertTemplateAccessible } from '@/lib/tenant';

const createJobSchema = z.object({
  name: z.string().min(2).max(80),
  siteId: z.string().uuid('Selecione um site'),
  templateId: z.string().uuid('Selecione um template'),
  scheduleCron: z.string().min(9, 'Cron inválido'),
  timezone: z.string().default('America/Sao_Paulo'),
  language: z.string().optional(),
  tags: z.string().default(''),
  categories: z.string().default(''),
  maxPostsPerRun: z.coerce.number().int().min(1).max(100).default(10),
  tokenBudgetPerRun: z.coerce.number().int().positive().default(500_000),
  skipIfSourcesUnchanged: z.boolean().default(true),
  mode: z.enum(['eco', 'full']).default('eco'),
  searchDepth: z.enum(['auto', 'basic', 'advanced']).default('auto'),
});

function parseIdList(raw: string): number[] {
  return raw
    .split(/[,\s]+/)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export async function createJobAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAuthedAction(createJobSchema, input, async (data, { workspaceId }) => {
    const db = getTenantDb(workspaceId);
    const [site] = await db
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.id, data.siteId), eq(sites.workspaceId, workspaceId)))
      .limit(1);
    if (!site) throw new UserFacingError('Site não encontrado.');
    await assertTemplateAccessible(data.templateId, workspaceId);

    let nextRunAt: Date;
    try {
      nextRunAt = computeNextRunAt(data.scheduleCron, data.timezone);
    } catch {
      throw new UserFacingError(`Expressão cron inválida: "${data.scheduleCron}"`);
    }

    // O modelo vem do perfil do admin (model_profiles); a config guarda só
    // o que ainda é do cliente.
    const [job] = await db
      .insert(contentJobs)
      .values({
        workspaceId,
        siteId: data.siteId,
        templateId: data.templateId,
        name: data.name.trim(),
        enabled: true,
        postFilter: postFilterSchema.parse({
          tags: parseIdList(data.tags),
          categories: parseIdList(data.categories),
          perPage: data.maxPostsPerRun,
        }),
        scheduleCron: data.scheduleCron,
        timezone: data.timezone,
        language: data.language || null,
        llmConfig: jobLlmConfigSchema.parse({}),
        limits: jobLimitsSchema.parse({
          maxPostsPerRun: data.maxPostsPerRun,
          tokenBudgetPerRun: data.tokenBudgetPerRun,
          skipIfSourcesUnchanged: data.skipIfSourcesUnchanged,
          mode: data.mode,
          searchDepth: data.searchDepth,
        }),
        nextRunAt,
      })
      .returning({ id: contentJobs.id });

    revalidatePath('/jobs');
    return { id: job!.id };
  });
}

const idSchema = z.object({ id: z.string().uuid() });
const toggleSchema = z.object({ id: z.string().uuid(), enabled: z.boolean() });
const updateJobSchema = createJobSchema.extend({ id: z.string().uuid() });

/** Edita um job existente (nome, filtro, cron, modo, LLM). Recalcula o próximo disparo se ativo. */
export async function updateJobAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAuthedAction(updateJobSchema, input, async (data, { workspaceId }) => {
    const db = getTenantDb(workspaceId);
    const [job] = await db
      .select()
      .from(contentJobs)
      .where(and(eq(contentJobs.id, data.id), eq(contentJobs.workspaceId, workspaceId)))
      .limit(1);
    if (!job) throw new UserFacingError('Job não encontrado.');

    const [site] = await db
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.id, data.siteId), eq(sites.workspaceId, workspaceId)))
      .limit(1);
    if (!site) throw new UserFacingError('Site não encontrado.');
    await assertTemplateAccessible(data.templateId, workspaceId);

    let nextRunAt: Date;
    try {
      nextRunAt = computeNextRunAt(data.scheduleCron, data.timezone);
    } catch {
      throw new UserFacingError(`Expressão cron inválida: "${data.scheduleCron}"`);
    }

    // O modelo vem do perfil do admin (model_profiles); a config guarda só
    // o que ainda é do cliente.
    await db
      .update(contentJobs)
      .set({
        siteId: data.siteId,
        templateId: data.templateId,
        name: data.name.trim(),
        postFilter: postFilterSchema.parse({
          tags: parseIdList(data.tags),
          categories: parseIdList(data.categories),
          perPage: data.maxPostsPerRun,
        }),
        scheduleCron: data.scheduleCron,
        timezone: data.timezone,
        language: data.language || null,
        llmConfig: jobLlmConfigSchema.parse({}),
        limits: jobLimitsSchema.parse({
          maxPostsPerRun: data.maxPostsPerRun,
          tokenBudgetPerRun: data.tokenBudgetPerRun,
          skipIfSourcesUnchanged: data.skipIfSourcesUnchanged,
          mode: data.mode,
          searchDepth: data.searchDepth,
        }),
        // recalcula o próximo disparo só se o job está ativo (mesmo padrão do autopilot)
        nextRunAt: job.enabled ? nextRunAt : job.nextRunAt,
        updatedAt: new Date(),
      })
      .where(eq(contentJobs.id, data.id));

    revalidatePath('/jobs');
    return { id: data.id };
  });
}

export async function toggleJobAction(input: unknown): Promise<ActionResult> {
  return runAuthedAction(toggleSchema, input, async ({ id, enabled }, { workspaceId }) => {
    const db = getTenantDb(workspaceId);
    const [job] = await db
      .select()
      .from(contentJobs)
      .where(and(eq(contentJobs.id, id), eq(contentJobs.workspaceId, workspaceId)))
      .limit(1);
    if (!job) throw new UserFacingError('Job não encontrado.');

    await db
      .update(contentJobs)
      .set({
        enabled,
        // reativar recalcula o próximo disparo a partir de agora (evita "correr atrás" de horários passados)
        nextRunAt: enabled ? computeNextRunAt(job.scheduleCron, job.timezone) : job.nextRunAt,
        updatedAt: new Date(),
      })
      .where(eq(contentJobs.id, id));
    revalidatePath('/jobs');
    return null;
  });
}

export async function deleteJobAction(input: unknown): Promise<ActionResult> {
  return runAuthedAction(idSchema, input, async ({ id }, { workspaceId }) => {
    const db = getTenantDb(workspaceId);
    // Não excluir com execução em andamento — o worker precisaria de um job que não existe mais.
    const [running] = await db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.jobId, id), eq(runs.workspaceId, workspaceId), eq(runs.status, 'running')))
      .limit(1);
    if (running) throw new UserFacingError('Este job tem uma execução em andamento — pare a execução antes de excluir.');

    // Histórico preservado (runs.job_id vira NULL); estado de fontes do job cai junto (cascade).
    await db.delete(contentJobs).where(and(eq(contentJobs.id, id), eq(contentJobs.workspaceId, workspaceId)));
    revalidatePath('/jobs');
    revalidatePath('/runs');
    return null;
  });
}

export async function runJobNowAction(input: unknown): Promise<ActionResult<{ runId: string }>> {
  return runAuthedAction(idSchema, input, async ({ id }, { workspaceId, email }) => {
    await assertWorkspaceReady(workspaceId, email);
    const db = getTenantDb(workspaceId);
    const [job] = await db
      .select()
      .from(contentJobs)
      .where(and(eq(contentJobs.id, id), eq(contentJobs.workspaceId, workspaceId)))
      .limit(1);
    if (!job) throw new UserFacingError('Job não encontrado.');

    const [run] = await db
      .insert(runs)
      .values({ workspaceId, jobId: id, kind: 'update', trigger: 'manual', status: 'running' })
      .returning({ id: runs.id });

    const boss = await getBoss();
    const sent = await boss.send(
      'job.run',
      { jobId: id, runId: run!.id },
      { singletonKey: id, retryLimit: 2, expireInSeconds: 300 },
    );
    if (!sent) {
      await db
        .update(runs)
        .set({ status: 'cancelled', finishedAt: new Date(), error: 'execução anterior ainda em andamento' })
        .where(eq(runs.id, run!.id));
      throw new UserFacingError('Já existe uma execução deste job em andamento.');
    }

    revalidatePath('/runs');
    revalidatePath('/jobs');
    return { runId: run!.id };
  });
}
