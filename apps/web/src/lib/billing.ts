import 'server-only';
import { and, eq, gte, sql } from 'drizzle-orm';
import { getDb, llmCalls, runItems, subscriptions, users } from '@content-pilot/db';
import { effectivePlan, PLANS, type PlanDef } from '@content-pilot/core';

/** Plano efetivo do workspace no painel (espelha o plan-guard do worker). */
export async function getWorkspacePlan(workspaceId: string): Promise<PlanDef> {
  const db = getDb();
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.workspaceId, workspaceId), eq(users.role, 'admin')))
    .limit(1);
  if (admin) return PLANS.unlimited;

  const [sub] = await db
    .select({ plan: subscriptions.plan, status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, workspaceId))
    .limit(1);
  return effectivePlan(sub);
}

export async function getSubscription(workspaceId: string) {
  const db = getDb();
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
  const db = getDb();
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
