'use server';

import { revalidatePath } from 'next/cache';
import { CronExpressionParser } from 'cron-parser';
import { and, contentJobs, eq, getDb, runs, sites } from '@content-pilot/db';
import { jobLimitsSchema, jobLlmConfigSchema, postFilterSchema } from '@content-pilot/core';
import { z } from 'zod';
import { runAuthedAction, type ActionResult } from '@/lib/action-utils';
import { getBoss } from '@/lib/boss';

function computeNextRunAt(cron: string, timezone: string): Date {
  return CronExpressionParser.parse(cron, { tz: timezone }).next().toDate();
}

const createJobSchema = z.object({
  name: z.string().min(2).max(80),
  siteId: z.string().uuid('Selecione um site'),
  templateId: z.string().uuid('Selecione um template'),
  scheduleCron: z.string().min(9, 'Cron inválido'),
  timezone: z.string().default('America/Sao_Paulo'),
  language: z.string().optional(),
  tags: z.string().default(''),
  categories: z.string().default(''),
  provider: z.enum(['anthropic', 'openai', 'openrouter']),
  model: z.string().min(1),
  maxPostsPerRun: z.coerce.number().int().min(1).max(100).default(10),
  tokenBudgetPerRun: z.coerce.number().int().positive().default(500_000),
  skipIfSourcesUnchanged: z.boolean().default(true),
  mode: z.enum(['eco', 'full']).default('eco'),
});

function parseIdList(raw: string): number[] {
  return raw
    .split(/[,\s]+/)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export async function createJobAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAuthedAction(createJobSchema, input, async (data, { workspaceId }) => {
    const db = getDb();
    const [site] = await db
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.id, data.siteId), eq(sites.workspaceId, workspaceId)))
      .limit(1);
    if (!site) throw new Error('Site não encontrado.');

    let nextRunAt: Date;
    try {
      nextRunAt = computeNextRunAt(data.scheduleCron, data.timezone);
    } catch {
      throw new Error(`Expressão cron inválida: "${data.scheduleCron}"`);
    }

    const llmTask = { provider: data.provider, model: data.model };
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
        llmConfig: jobLlmConfigSchema.parse({ generate: llmTask, verify: llmTask }),
        limits: jobLimitsSchema.parse({
          maxPostsPerRun: data.maxPostsPerRun,
          tokenBudgetPerRun: data.tokenBudgetPerRun,
          skipIfSourcesUnchanged: data.skipIfSourcesUnchanged,
          mode: data.mode,
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

export async function toggleJobAction(input: unknown): Promise<ActionResult> {
  return runAuthedAction(toggleSchema, input, async ({ id, enabled }, { workspaceId }) => {
    const db = getDb();
    const [job] = await db
      .select()
      .from(contentJobs)
      .where(and(eq(contentJobs.id, id), eq(contentJobs.workspaceId, workspaceId)))
      .limit(1);
    if (!job) throw new Error('Job não encontrado.');

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
    const db = getDb();
    try {
      await db.delete(contentJobs).where(and(eq(contentJobs.id, id), eq(contentJobs.workspaceId, workspaceId)));
    } catch {
      throw new Error('Job possui histórico de execuções — desative-o em vez de excluir.');
    }
    revalidatePath('/jobs');
    return null;
  });
}

export async function runJobNowAction(input: unknown): Promise<ActionResult<{ runId: string }>> {
  return runAuthedAction(idSchema, input, async ({ id }, { workspaceId }) => {
    const db = getDb();
    const [job] = await db
      .select()
      .from(contentJobs)
      .where(and(eq(contentJobs.id, id), eq(contentJobs.workspaceId, workspaceId)))
      .limit(1);
    if (!job) throw new Error('Job não encontrado.');

    const [run] = await db
      .insert(runs)
      .values({ workspaceId, jobId: id, trigger: 'manual', status: 'running' })
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
      throw new Error('Já existe uma execução deste job em andamento.');
    }

    revalidatePath('/runs');
    revalidatePath('/jobs');
    return { runId: run!.id };
  });
}
