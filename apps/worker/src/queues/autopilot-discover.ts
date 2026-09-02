import {
  and,
  autopilotConfigs,
  briefs,
  discoveredTopics,
  eq,
  gte,
  isNotNull,
  llmCalls,
  runs,
  sites,
  sql,
  type Db,
} from '@content-pilot/db';
import {
  autopilotLlmConfigSchema,
  parseAutopilotDiscovery,
  parseAutopilotLimits,
  PlanLimitError,
  runDiscovery,
  type DiscoveryCandidate,
} from '@content-pilot/core';
import type { PgBoss } from 'pg-boss';
import {
  resolveLlmProvider,
  resolveSearchClient,
  resolveWordPressAdapter,
} from '../lib/resolve';
import { makeBudgetGuard, recordLlmCalls } from '../lib/run-helpers';
import { createRunLogger } from '../lib/run-logger';
import { assertPlanAllowsGeneration, getAutopilotMonthCost } from '../lib/plan-guard';
import { QUEUE, type AutopilotDiscoverPayload } from './names';

/**
 * autopilot.discover: descobre temas em alta no nicho, deduplica contra o que
 * já foi publicado/planejado e cria pautas (briefs) para os temas novos. Se a
 * config estiver em autoQueue, já enfileira a geração de cada pauta (reusa o
 * pipeline brief.generate existente).
 */
export async function handleAutopilotDiscover(db: Db, boss: PgBoss, payload: AutopilotDiscoverPayload) {
  const { autopilotConfigId, runId } = payload;
  const startedAt = Date.now();

  const [run] = await db.select({ status: runs.status }).from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run || run.status !== 'running') {
    console.log(`[autopilot ${autopilotConfigId}] run não está em execução — abortando`);
    return;
  }

  const [cfg] = await db
    .select()
    .from(autopilotConfigs)
    .where(eq(autopilotConfigs.id, autopilotConfigId))
    .limit(1);
  if (!cfg) throw new Error(`autopilot config ${autopilotConfigId} não existe`);
  const workspaceId = cfg.workspaceId;
  const logger = createRunLogger(db, runId, `[autopilot ${autopilotConfigId}]`);
  const log = logger.log;

  const finalizeFailed = async (error: string) => {
    await db
      .update(runs)
      .set({ status: 'failed', finishedAt: new Date(), error })
      .where(and(eq(runs.id, runId), eq(runs.status, 'running')));
    log(`falha: ${error}`);
  };

  try {
    const discovery = parseAutopilotDiscovery(cfg.discovery);
    const llmConfig = autopilotLlmConfigSchema.parse(cfg.llmConfig);
    const limits = parseAutopilotLimits(cfg.limits);

    // ---- Kill-switches (Fase 4): tudo determinístico, antes de gastar IA ----
    // 1. Plano do workspace ainda permite gerar posts este mês?
    await assertPlanAllowsGeneration(db, workspaceId);

    // 2. Orçamento mensal desta config (descoberta + gerações atribuídas a ela).
    const monthCost = await getAutopilotMonthCost(db, autopilotConfigId);
    if (monthCost >= limits.monthlyBudgetUsd) {
      log(`orçamento mensal atingido (US$ ${monthCost.toFixed(2)} de US$ ${limits.monthlyBudgetUsd.toFixed(2)})`);
      await finalizeSkipped(
        db,
        runId,
        `Orçamento mensal de US$ ${limits.monthlyBudgetUsd.toFixed(2)} atingido (gasto: US$ ${monthCost.toFixed(2)}). O autopilot volta no próximo mês ou quando o limite for aumentado.`,
      );
      return;
    }

    // 3. Máximo de pautas por dia (janela móvel de 24h).
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
    const [{ createdToday }] = (await db
      .select({ createdToday: sql<number>`count(*)` })
      .from(discoveredTopics)
      .where(
        and(
          eq(discoveredTopics.autopilotConfigId, autopilotConfigId),
          isNotNull(discoveredTopics.briefId),
          gte(discoveredTopics.createdAt, dayAgo),
        ),
      )) as [{ createdToday: number }];
    const remainingToday = limits.maxPostsPerDay - Number(createdToday);
    if (remainingToday <= 0) {
      log(`limite diário de pautas atingido (${limits.maxPostsPerDay}/24h)`);
      await finalizeSkipped(
        db,
        runId,
        `Limite de ${limits.maxPostsPerDay} pautas nas últimas 24h atingido — próximo ciclo tenta de novo.`,
      );
      return;
    }
    const postsThisCycle = Math.min(discovery.postsPerCycle, remainingToday);

    const [site] = await db.select().from(sites).where(eq(sites.id, cfg.siteId)).limit(1);
    if (!site) throw new Error('site da config não existe');

    const [wp, search, llmDiscover] = await Promise.all([
      resolveWordPressAdapter(db, site),
      resolveSearchClient(db, workspaceId),
      resolveLlmProvider(db, workspaceId, llmConfig.discover),
    ]);

    // Inventário do que já existe: posts recentes do WP + pautas do workspace + temas já descobertos.
    const [wpPosts, existingBriefs, priorTopics] = await Promise.all([
      wp.listRecentPostTitles(discovery.dedupeLookback).catch((err) => {
        log(`listRecentPostTitles falhou: ${err}`);
        return [] as { title: string }[];
      }),
      db.select({ topic: briefs.topic }).from(briefs).where(eq(briefs.workspaceId, workspaceId)),
      db
        .select({ topic: discoveredTopics.topic })
        .from(discoveredTopics)
        .where(eq(discoveredTopics.autopilotConfigId, autopilotConfigId)),
    ]);
    const existingTitles = [
      ...wpPosts.map((p) => p.title),
      ...existingBriefs.map((b) => b.topic),
      ...priorTopics.map((t) => t.topic),
    ].filter(Boolean);

    const result = await runDiscovery(
      {
        seedTopics: cfg.seedTopics,
        language: cfg.language,
        siteName: site.name,
        existingTitles,
        postsPerCycle: postsThisCycle,
        allowedTypes: discovery.allowedTypes.length ? discovery.allowedTypes : undefined,
      },
      {
        search,
        llmDiscover,
        checkBudget: makeBudgetGuard(db, runId, discovery.discoverTokenBudget),
        log,
      },
    );

    await recordLlmCalls(db, workspaceId, runId, null, result.llmCalls);

    // Descartados → feed (memória de dedup entre ciclos), num insert só
    if (result.discarded.length > 0) {
      await db.insert(discoveredTopics).values(
        result.discarded.map((d) => ({
          workspaceId,
          autopilotConfigId,
          runId,
          topic: d.topic,
          contentType: 'evergreen',
          status: (d.reason.includes('similar') || d.reason.toLowerCase().includes('cobert')
            ? 'discarded_duplicate'
            : 'discarded_low_value') as 'discarded_duplicate' | 'discarded_low_value',
          discardReason: d.reason,
        })),
      );
    }

    // Sobreviventes → pauta + feed; opcionalmente enfileira geração
    let queued = 0;
    for (const candidate of result.kept) {
      const briefId = await createBriefFromCandidate(db, cfg, candidate, limits.generationTokenBudget);
      const status = cfg.autoQueue ? 'queued' : 'pending';
      await db.insert(discoveredTopics).values({
        workspaceId,
        autopilotConfigId,
        runId,
        topic: candidate.topic,
        contentType: candidate.contentType,
        keywords: candidate.keywords,
        angle: candidate.angle || null,
        suggestedTitle: candidate.suggestedTitle || null,
        status,
        briefId,
      });
      if (cfg.autoQueue) {
        await enqueueBriefGeneration(db, boss, briefId, workspaceId, autopilotConfigId);
        queued++;
      }
    }

    const [tokens] = await db
      .select({
        tokensIn: sql<number>`coalesce(sum(${llmCalls.inputTokens}), 0)`,
        tokensOut: sql<number>`coalesce(sum(${llmCalls.outputTokens}), 0)`,
        cost: sql<string>`coalesce(sum(${llmCalls.costEstimateUsd}), 0)`,
      })
      .from(llmCalls)
      .where(eq(llmCalls.runId, runId));

    const status = result.status === 'ok' || result.status === 'no_candidates' ? 'success' : 'failed';
    await db
      .update(runs)
      .set({
        status,
        finishedAt: new Date(),
        error: status === 'failed' ? result.skipReason : null,
        stats: {
          discovered: result.kept.length,
          queued,
          pending: cfg.autoQueue ? 0 : result.kept.length,
          discarded: result.discarded.length,
          sources: result.sourcesCount,
          tokensIn: Number(tokens?.tokensIn ?? 0),
          tokensOut: Number(tokens?.tokensOut ?? 0),
          costEstimateUsd: Number(tokens?.cost ?? 0),
        },
      })
      .where(and(eq(runs.id, runId), eq(runs.status, 'running')));

    await db
      .update(autopilotConfigs)
      .set({ lastRunAt: new Date(), updatedAt: new Date() })
      .where(eq(autopilotConfigs.id, autopilotConfigId));

    log(
      `${result.kept.length} temas novos (${queued} enfileirados), ${result.discarded.length} descartados em ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
    );
  } catch (err) {
    // Limite de plano não é falha do sistema: registra como cancelado com o motivo.
    if (err instanceof PlanLimitError) {
      log(`ciclo pulado: ${err.message}`);
      await finalizeSkipped(db, runId, err.message);
      return;
    }
    await finalizeFailed(err instanceof Error ? err.message : String(err));
  } finally {
    await logger.flush();
  }
}

/** Encerra o run como cancelado por kill-switch (orçamento/limite), com o motivo visível no painel. */
async function finalizeSkipped(db: Db, runId: string, reason: string) {
  await db
    .update(runs)
    .set({ status: 'cancelled', finishedAt: new Date(), error: reason })
    .where(and(eq(runs.id, runId), eq(runs.status, 'running')));
  console.log(`[autopilot] ciclo pulado: ${reason}`);
}

/** Cria uma pauta (brief) a partir de um tema descoberto, herdando a config do autopilot. */
async function createBriefFromCandidate(
  db: Db,
  cfg: typeof autopilotConfigs.$inferSelect,
  candidate: DiscoveryCandidate,
  generationTokenBudget: number,
): Promise<string> {
  const llmConfig = autopilotLlmConfigSchema.parse(cfg.llmConfig);
  const extra = [
    candidate.angle ? `Ângulo editorial: ${candidate.angle}` : '',
    candidate.suggestedTitle ? `Título sugerido: ${candidate.suggestedTitle}` : '',
    `Tipo de conteúdo: ${candidate.contentType}`,
  ]
    .filter(Boolean)
    .join('\n');

  const [brief] = await db
    .insert(briefs)
    .values({
      workspaceId: cfg.workspaceId,
      siteId: cfg.siteId,
      templateId: cfg.templateId,
      topic: candidate.topic,
      keywords: candidate.keywords,
      language: cfg.language,
      extraInstructions: extra,
      publishMode: cfg.publishMode,
      status: cfg.autoQueue ? 'queued' : 'pending',
      llmConfig: {
        generate: llmConfig.generate,
        verify: llmConfig.verify,
        tokenBudget: generationTokenBudget,
      },
    })
    .returning({ id: briefs.id });
  return brief!.id;
}

/**
 * Enfileira a geração de uma pauta criada pelo autopilot. O run carrega o
 * autopilotConfigId — é isso que permite atribuir o custo da geração ao
 * orçamento mensal da config (kill-switch da Fase 4).
 */
async function enqueueBriefGeneration(
  db: Db,
  boss: PgBoss,
  briefId: string,
  workspaceId: string,
  autopilotConfigId: string,
) {
  const [run] = await db
    .insert(runs)
    .values({ workspaceId, briefId, autopilotConfigId, kind: 'create', trigger: 'autopilot', status: 'running' })
    .returning({ id: runs.id });
  const sent = await boss.send(
    QUEUE.briefGenerate,
    { briefId, runId: run!.id },
    { singletonKey: briefId, retryLimit: 1, retryDelay: 120, expireInSeconds: 900 },
  );
  if (!sent) {
    await db
      .update(runs)
      .set({ status: 'cancelled', finishedAt: new Date(), error: 'geração já em andamento' })
      .where(eq(runs.id, run!.id));
  }
}
