import 'server-only';
import { and, eq, gte, sql } from 'drizzle-orm';
import {
  getTenantDb,
  llmCalls,
  runItems,
  subscriptions,
  usesOwnLlmKey,
  workspaces,
} from '@content-pilot/db';
import { effectivePlan, PLANS, withByokConsumption, type PlanDef } from '@content-pilot/core';

/**
 * Plano efetivo do workspace no painel (espelha o plan-guard do worker).
 *
 * A isenção vem de `workspaces.billingBypass`, concedida explicitamente pelo
 * super admin. Antes ela era derivada de "existe algum usuário admin neste
 * workspace", o que daria uso ilimitado de graça ao workspace de todo admin
 * assim que a promoção de admins virasse uma ação do painel.
 */
export async function getWorkspacePlan(workspaceId: string): Promise<PlanDef> {
  const db = getTenantDb(workspaceId);
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

/** O workspace tem chave de IA própria? Espelha o guard do worker. */
export async function isByokWorkspace(workspaceId: string): Promise<boolean> {
  return usesOwnLlmKey(getTenantDb(workspaceId), workspaceId);
}

/**
 * Plano para exibir CONSUMO (posts/tokens), com as cotas removidas quando o
 * workspace traz a própria chave. Para sites e autopilots use
 * `getWorkspacePlan`: esses limites valem mesmo com BYOK.
 */
export async function getConsumptionPlan(workspaceId: string): Promise<PlanDef> {
  const plan = await getWorkspacePlan(workspaceId);
  if (plan.id === 'unlimited') return plan;
  return withByokConsumption(plan, await isByokWorkspace(workspaceId));
}

export async function getSubscription(workspaceId: string) {
  const db = getTenantDb(workspaceId);
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, workspaceId))
    .limit(1);
  return sub ?? null;
}

export interface UsageSummary {
  postsCreated: number;
  tokensUsed: number;
  costUsd: number;
}

/** Uso do mês corrente (UTC), para a página de cobrança e para os cards do painel. */
export async function getMonthUsage(workspaceId: string): Promise<UsageSummary> {
  const db = getTenantDb(workspaceId);
  const now = new Date();
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
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
