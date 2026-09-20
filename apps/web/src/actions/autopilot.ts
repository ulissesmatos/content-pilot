'use server';

import { UserFacingError } from '@/lib/errors';
import { revalidatePath } from 'next/cache';
import { and, autopilotConfigs, briefs, discoveredTopics, eq, getTenantDb, runs, sites } from '@content-pilot/db';
import {
  autopilotDiscoverySchema,
  autopilotLimitsSchema,
  autopilotLlmConfigSchema,
  CONTENT_TYPES,
  nextRunAt as computeNextRunAt,
} from '@content-pilot/core';
import { z } from 'zod';
import { runAuthedAction, type ActionResult } from '@/lib/action-utils';
import { assertWorkspaceReady } from '@/lib/readiness';
import { getWorkspacePlan } from '@/lib/billing';
import { getBoss } from '@/lib/boss';
import { assertTemplateAccessible } from '@/lib/tenant';

const createAutopilotSchema = z.object({
  name: z.string().min(2).max(80),
  siteId: z.string().uuid('Selecione um site'),
  templateId: z.string().uuid('Selecione um template'),
  seedTopics: z.string().min(2, 'Informe ao menos um tema-semente'),
  language: z.string().min(2).max(10).default('pt-BR'),
  scheduleCron: z.string().min(9, 'Cron inválido'),
  timezone: z.string().default('America/Sao_Paulo'),
  autoQueue: z.boolean().default(false),
  publishMode: z.enum(['draft', 'publish']).default('draft'),
  postsPerCycle: z.coerce.number().int().min(1).max(20).default(3),
  allowedTypes: z.array(z.enum(CONTENT_TYPES)).default([]),
  discoverTokenBudget: z.coerce.number().int().positive().default(60_000),
  // kill-switches (Fase 4)
  monthlyBudgetUsd: z.coerce.number().positive().max(10_000).default(20),
  maxPostsPerDay: z.coerce.number().int().min(1).max(50).default(5),
});

function parseSeedTopics(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);
}

export async function createAutopilotAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAuthedAction(createAutopilotSchema, input, async (data, { workspaceId }) => {
    const db = getTenantDb(workspaceId);

    // limite de autopilots do plano (Fase 5)
    const plan = await getWorkspacePlan(workspaceId);
    const existing = await db
      .select({ id: autopilotConfigs.id })
      .from(autopilotConfigs)
      .where(eq(autopilotConfigs.workspaceId, workspaceId));
    if (existing.length >= plan.limits.maxAutopilots) {
      throw new UserFacingError(
        `Seu plano permite ${plan.limits.maxAutopilots} autopilot(s). Faça upgrade em Plano e cobrança para criar mais.`,
      );
    }

    const [site] = await db
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.id, data.siteId), eq(sites.workspaceId, workspaceId)))
      .limit(1);
    if (!site) throw new UserFacingError('Site não encontrado.');
    await assertTemplateAccessible(data.templateId, workspaceId);

    const seedTopics = parseSeedTopics(data.seedTopics);
    if (seedTopics.length === 0) throw new UserFacingError('Informe ao menos um tema-semente.');

    let nextRunAt: Date;
    try {
      nextRunAt = computeNextRunAt(data.scheduleCron, data.timezone);
    } catch {
      throw new UserFacingError(`Expressão cron inválida: "${data.scheduleCron}"`);
    }

    // O modelo vem do perfil do admin (model_profiles); a config guarda só
    // o que ainda é do cliente.
    const [cfg] = await db
      .insert(autopilotConfigs)
      .values({
        workspaceId,
        siteId: data.siteId,
        templateId: data.templateId,
        name: data.name.trim(),
        enabled: true,
        seedTopics,
        language: data.language,
        scheduleCron: data.scheduleCron,
        timezone: data.timezone,
        autoQueue: data.autoQueue,
        publishMode: data.publishMode,
        discovery: autopilotDiscoverySchema.parse({
          postsPerCycle: data.postsPerCycle,
          allowedTypes: data.allowedTypes,
          discoverTokenBudget: data.discoverTokenBudget,
        }),
        llmConfig: autopilotLlmConfigSchema.parse({}),
        limits: autopilotLimitsSchema.parse({
          monthlyBudgetUsd: data.monthlyBudgetUsd,
          maxPostsPerDay: data.maxPostsPerDay,
        }),
        nextRunAt,
      })
      .returning({ id: autopilotConfigs.id });

    revalidatePath('/autopilot');
    return { id: cfg!.id };
  });
}

const updateAutopilotSchema = createAutopilotSchema.extend({ id: z.string().uuid() });

export async function updateAutopilotAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAuthedAction(updateAutopilotSchema, input, async (data, { workspaceId }) => {
    const db = getTenantDb(workspaceId);
    const [cfg] = await db
      .select()
      .from(autopilotConfigs)
      .where(and(eq(autopilotConfigs.id, data.id), eq(autopilotConfigs.workspaceId, workspaceId)))
      .limit(1);
    if (!cfg) throw new UserFacingError('Autopilot não encontrado.');

    const [site] = await db
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.id, data.siteId), eq(sites.workspaceId, workspaceId)))
      .limit(1);
    if (!site) throw new UserFacingError('Site não encontrado.');
    await assertTemplateAccessible(data.templateId, workspaceId);

    const seedTopics = parseSeedTopics(data.seedTopics);
    if (seedTopics.length === 0) throw new UserFacingError('Informe ao menos um tema-semente.');

    let nextRunAt: Date;
    try {
      nextRunAt = computeNextRunAt(data.scheduleCron, data.timezone);
    } catch {
      throw new UserFacingError(`Expressão cron inválida: "${data.scheduleCron}"`);
    }

    // O modelo vem do perfil do admin (model_profiles); a config guarda só
    // o que ainda é do cliente.
    await db
      .update(autopilotConfigs)
      .set({
        siteId: data.siteId,
        templateId: data.templateId,
        name: data.name.trim(),
        seedTopics,
        language: data.language,
        scheduleCron: data.scheduleCron,
        timezone: data.timezone,
        autoQueue: data.autoQueue,
        publishMode: data.publishMode,
        discovery: autopilotDiscoverySchema.parse({
          postsPerCycle: data.postsPerCycle,
          allowedTypes: data.allowedTypes,
          discoverTokenBudget: data.discoverTokenBudget,
        }),
        llmConfig: autopilotLlmConfigSchema.parse({}),
        limits: autopilotLimitsSchema.parse({
          monthlyBudgetUsd: data.monthlyBudgetUsd,
          maxPostsPerDay: data.maxPostsPerDay,
        }),
        // recalcula a próxima descoberta só se o autopilot está ativo
        nextRunAt: cfg.enabled ? nextRunAt : cfg.nextRunAt,
        updatedAt: new Date(),
      })
      .where(eq(autopilotConfigs.id, data.id));

    revalidatePath('/autopilot');
    return { id: data.id };
  });
}

const idSchema = z.object({ id: z.string().uuid() });
const toggleSchema = z.object({ id: z.string().uuid(), enabled: z.boolean() });

export async function toggleAutopilotAction(input: unknown): Promise<ActionResult> {
  return runAuthedAction(toggleSchema, input, async ({ id, enabled }, { workspaceId }) => {
    const db = getTenantDb(workspaceId);
    const [cfg] = await db
      .select()
      .from(autopilotConfigs)
      .where(and(eq(autopilotConfigs.id, id), eq(autopilotConfigs.workspaceId, workspaceId)))
      .limit(1);
    if (!cfg) throw new UserFacingError('Autopilot não encontrado.');

    await db
      .update(autopilotConfigs)
      .set({
        enabled,
        nextRunAt: enabled ? computeNextRunAt(cfg.scheduleCron, cfg.timezone) : cfg.nextRunAt,
        updatedAt: new Date(),
      })
      .where(eq(autopilotConfigs.id, id));
    revalidatePath('/autopilot');
    return null;
  });
}

export async function deleteAutopilotAction(input: unknown): Promise<ActionResult> {
  return runAuthedAction(idSchema, input, async ({ id }, { workspaceId }) => {
    const db = getTenantDb(workspaceId);
    // Não excluir com descoberta/geração em andamento atribuída a esta config.
    const [running] = await db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.autopilotConfigId, id), eq(runs.workspaceId, workspaceId), eq(runs.status, 'running')))
      .limit(1);
    if (running) throw new UserFacingError('Este autopilot tem uma execução em andamento — pare a execução antes de excluir.');

    // Histórico de runs preservado (autopilot_config_id vira NULL); o feed de temas cai junto
    // (cascade); as pautas criadas permanecem em /briefs.
    await db
      .delete(autopilotConfigs)
      .where(and(eq(autopilotConfigs.id, id), eq(autopilotConfigs.workspaceId, workspaceId)));
    revalidatePath('/autopilot');
    revalidatePath('/runs');
    return null;
  });
}

/**
 * Gera agora a pauta de um tema descoberto que ficou pendente (autoQueue off).
 * O run leva o autopilotConfigId — o custo conta no orçamento mensal da config.
 */
export async function generateTopicNowAction(input: unknown): Promise<ActionResult<{ runId: string }>> {
  return runAuthedAction(idSchema, input, async ({ id }, { workspaceId, email }) => {
    await assertWorkspaceReady(workspaceId, email);
    const db = getTenantDb(workspaceId);
    const [topic] = await db
      .select()
      .from(discoveredTopics)
      .where(and(eq(discoveredTopics.id, id), eq(discoveredTopics.workspaceId, workspaceId)))
      .limit(1);
    if (!topic) throw new UserFacingError('Tema não encontrado.');
    if (topic.status !== 'pending') throw new UserFacingError('Só temas pendentes podem ser gerados por aqui.');
    if (!topic.briefId) throw new UserFacingError('Tema sem pauta associada — crie uma pauta manualmente em Criar posts.');

    const [brief] = await db
      .select({ id: briefs.id, status: briefs.status })
      .from(briefs)
      .where(and(eq(briefs.id, topic.briefId), eq(briefs.workspaceId, workspaceId)))
      .limit(1);
    if (!brief) throw new UserFacingError('A pauta deste tema foi excluída — crie uma nova em Criar posts.');
    if (brief.status !== 'pending' && brief.status !== 'failed') {
      throw new UserFacingError('A pauta deste tema já está em andamento ou concluída — veja em Criar posts.');
    }

    await db
      .update(briefs)
      .set({ status: 'queued', error: null, updatedAt: new Date() })
      .where(eq(briefs.id, brief.id));

    const [run] = await db
      .insert(runs)
      .values({
        workspaceId,
        briefId: brief.id,
        autopilotConfigId: topic.autopilotConfigId,
        kind: 'create',
        trigger: 'manual',
        status: 'running',
      })
      .returning({ id: runs.id });

    const boss = await getBoss();
    const sent = await boss.send(
      'brief.generate',
      { briefId: brief.id, runId: run!.id },
      { singletonKey: brief.id, retryLimit: 1, retryDelay: 120, expireInSeconds: 900 },
    );
    if (!sent) {
      await db
        .update(runs)
        .set({ status: 'cancelled', finishedAt: new Date(), error: 'geração anterior ainda em andamento' })
        .where(eq(runs.id, run!.id));
      throw new UserFacingError('Esta pauta já está sendo gerada.');
    }

    await db.update(discoveredTopics).set({ status: 'queued' }).where(eq(discoveredTopics.id, id));

    revalidatePath('/autopilot');
    revalidatePath('/briefs');
    revalidatePath('/runs');
    return { runId: run!.id };
  });
}

/**
 * Descarta manualmente um tema pendente. A pauta associada (se ainda pendente)
 * é excluída; o tema fica no feed como memória de dedup — não volta a ser sugerido.
 */
export async function dismissTopicAction(input: unknown): Promise<ActionResult> {
  return runAuthedAction(idSchema, input, async ({ id }, { workspaceId }) => {
    const db = getTenantDb(workspaceId);
    const [topic] = await db
      .select()
      .from(discoveredTopics)
      .where(and(eq(discoveredTopics.id, id), eq(discoveredTopics.workspaceId, workspaceId)))
      .limit(1);
    if (!topic) throw new UserFacingError('Tema não encontrado.');
    if (topic.status !== 'pending') throw new UserFacingError('Só temas pendentes podem ser descartados.');

    if (topic.briefId) {
      const [brief] = await db
        .select({ id: briefs.id, status: briefs.status })
        .from(briefs)
        .where(and(eq(briefs.id, topic.briefId), eq(briefs.workspaceId, workspaceId)))
        .limit(1);
      // só remove a pauta se ela ainda não gerou nada (SET NULL limpa topic.briefId)
      if (brief && (brief.status === 'pending' || brief.status === 'failed')) {
        await db.delete(briefs).where(eq(briefs.id, brief.id));
      }
    }

    await db
      .update(discoveredTopics)
      .set({ status: 'dismissed', discardReason: 'descartado manualmente' })
      .where(eq(discoveredTopics.id, id));

    revalidatePath('/autopilot');
    revalidatePath('/briefs');
    return null;
  });
}

export async function runAutopilotNowAction(input: unknown): Promise<ActionResult<{ runId: string }>> {
  return runAuthedAction(idSchema, input, async ({ id }, { workspaceId, email }) => {
    await assertWorkspaceReady(workspaceId, email);
    const db = getTenantDb(workspaceId);
    const [cfg] = await db
      .select({ id: autopilotConfigs.id })
      .from(autopilotConfigs)
      .where(and(eq(autopilotConfigs.id, id), eq(autopilotConfigs.workspaceId, workspaceId)))
      .limit(1);
    if (!cfg) throw new UserFacingError('Autopilot não encontrado.');

    const [run] = await db
      .insert(runs)
      .values({ workspaceId, autopilotConfigId: id, kind: 'discover', trigger: 'manual', status: 'running' })
      .returning({ id: runs.id });

    const boss = await getBoss();
    const sent = await boss.send(
      'autopilot.discover',
      { autopilotConfigId: id, runId: run!.id },
      { singletonKey: id, retryLimit: 1, expireInSeconds: 600 },
    );
    if (!sent) {
      await db
        .update(runs)
        .set({ status: 'cancelled', finishedAt: new Date(), error: 'descoberta anterior ainda em andamento' })
        .where(eq(runs.id, run!.id));
      throw new UserFacingError('Já existe uma descoberta deste autopilot em andamento.');
    }

    revalidatePath('/runs');
    revalidatePath('/autopilot');
    return { runId: run!.id };
  });
}
