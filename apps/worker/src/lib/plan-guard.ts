import {
  and,
  eq,
  gte,
  inArray,
  llmCalls,
  runItems,
  runs,
  sql,
  subscriptions,
  usesOwnLlmKey,
  workspaces,
  type Db,
} from '@content-pilot/db';
import {
  effectivePlan,
  PlanLimitError,
  PLANS,
  withByokConsumption,
  type PlanDef,
} from '@content-pilot/core';

/**
 * Enforcement de plano (Fase 5) — tudo determinístico, verificado ANTES de
 * gastar IA. Isenção só via `workspaces.billingBypass` (concedida pelo super
 * admin); sem linha em subscriptions = free.
 *
 * A isenção NÃO é derivada de cargo: antes bastava haver um usuário admin no
 * workspace para ele virar ilimitado, o que vazaria uso gratuito assim que
 * admins pudessem ser promovidos pelo painel.
 */

export async function getWorkspacePlan(db: Db, workspaceId: string): Promise<PlanDef> {
  const [ws] = await db
    .select({ billingBypass: workspaces.billingBypass })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (ws?.billingBypass) return PLANS.unlimited;

  const [sub] = await db
    .select({ plan: subscriptions.plan, status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, workspaceId))
    .limit(1);
  return effectivePlan(sub);
}

export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export interface MonthUsage {
  postsCreated: number;
  tokensUsed: number;
  costUsd: number;
}

/** Uso do mês corrente (UTC) do workspace: posts criados + tokens/custo LLM. */
export async function getMonthUsage(db: Db, workspaceId: string, now = new Date()): Promise<MonthUsage> {
  const since = monthStart(now);
  const [postsRow, tokensRow] = await Promise.all([
    db
      .select({ total: sql<number>`count(*)` })
      .from(runItems)
      .where(
        and(
          eq(runItems.workspaceId, workspaceId),
          eq(runItems.status, 'created'),
          gte(runItems.createdAt, since),
        ),
      ),
    db
      .select({
        tokens: sql<number>`coalesce(sum(${llmCalls.inputTokens} + ${llmCalls.outputTokens}), 0)`,
        cost: sql<string>`coalesce(sum(${llmCalls.costEstimateUsd}), 0)`,
      })
      .from(llmCalls)
      .where(and(eq(llmCalls.workspaceId, workspaceId), gte(llmCalls.createdAt, since))),
  ]);
  return {
    postsCreated: Number(postsRow[0]?.total ?? 0),
    tokensUsed: Number(tokensRow[0]?.tokens ?? 0),
    costUsd: Number(tokensRow[0]?.cost ?? 0),
  };
}

/**
 * Lança PlanLimitError se o workspace não pode gerar mais um post este mês
 * (limite de posts ou de tokens do plano). Chamado no início de brief.generate
 * e antes do autopilot enfileirar gerações.
 */
export async function assertPlanAllowsGeneration(db: Db, workspaceId: string): Promise<void> {
  const plan = await consumptionPlan(db, workspaceId);
  if (plan.id === 'unlimited') return;
  const usage = await getMonthUsage(db, workspaceId);
  if (usage.postsCreated >= plan.limits.postsPerMonth) {
    throw new PlanLimitError(
      `Limite de ${plan.limits.postsPerMonth} posts/mês atingido (${usage.postsCreated} criados). Cadastre sua própria chave de IA em Credenciais para gerar sem limite de volume.`,
      'postsPerMonth',
    );
  }
  assertTokensWithinPlan(plan, usage);
}

/** Só o teto de tokens (jobs de ATUALIZAÇÃO consomem tokens mas não criam posts). */
export async function assertPlanAllowsLlmUsage(db: Db, workspaceId: string): Promise<void> {
  const plan = await consumptionPlan(db, workspaceId);
  if (plan.id === 'unlimited') return;
  assertTokensWithinPlan(plan, await getMonthUsage(db, workspaceId));
}

/**
 * Plano visto pelos guards de consumo: o do workspace, com posts/tokens
 * liberados quando ele traz a própria chave de IA. Os limites de sites e
 * autopilots não passam por aqui — quem os cobra é o painel, com o plano cru.
 */
async function consumptionPlan(db: Db, workspaceId: string): Promise<PlanDef> {
  const plan = await getWorkspacePlan(db, workspaceId);
  if (plan.id === 'unlimited') return plan;
  return withByokConsumption(plan, await usesOwnLlmKey(db, workspaceId));
}

function assertTokensWithinPlan(plan: PlanDef, usage: MonthUsage): void {
  if (usage.tokensUsed >= plan.limits.tokensPerMonth) {
    throw new PlanLimitError(
      `Limite de ${Math.round(plan.limits.tokensPerMonth / 1_000_000)}M tokens/mês atingido. Cadastre sua própria chave de IA em Credenciais para gerar sem limite de volume.`,
      'tokensPerMonth',
    );
  }
}

/** Custo LLM (USD) do mês corrente atribuído a uma config de autopilot. */
export async function getAutopilotMonthCost(
  db: Db,
  autopilotConfigId: string,
  now = new Date(),
): Promise<number> {
  const since = monthStart(now);
  const runRows = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.autopilotConfigId, autopilotConfigId), gte(runs.startedAt, since)));
  if (runRows.length === 0) return 0;
  const [row] = await db
    .select({ cost: sql<string>`coalesce(sum(${llmCalls.costEstimateUsd}), 0)` })
    .from(llmCalls)
    .where(
      and(
        inArray(
          llmCalls.runId,
          runRows.map((r) => r.id),
        ),
        gte(llmCalls.createdAt, since),
      ),
    );
  return Number(row?.cost ?? 0);
}
