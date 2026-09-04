import {
  and,
  count,
  eq,
  getPriceTable,
  gte,
  inArray,
  llmCalls,
  runItems,
  runs,
  sourceCache,
  sql,
  type Db,
} from '@content-pilot/db';
import {
  BudgetExceededError,
  estimateCostUsd,
  normalizeUrl,
  type LlmCallRecord,
  type SearchClient,
  type TavilyExtractResult,
} from '@content-pilot/core';

/** Guard de orçamento: soma tokens do run antes de cada chamada LLM. */
export function makeBudgetGuard(db: Db, runId: string, tokenBudget: number) {
  return async () => {
    const [row] = await db
      .select({
        total: sql<number>`coalesce(sum(${llmCalls.inputTokens} + ${llmCalls.outputTokens}), 0)`,
      })
      .from(llmCalls)
      .where(eq(llmCalls.runId, runId));
    if (Number(row?.total ?? 0) >= tokenBudget) {
      throw new BudgetExceededError(`Orçamento de ${tokenBudget} tokens do run excedido`);
    }
  };
}

/** Extract com cache em source_cache (TTL 12h) — economiza créditos Tavily entre posts/execuções. */
export function makeCachedExtract(db: Db, workspaceId: string, search: SearchClient, ttlHours = 12) {
  return async (urls: string[]): Promise<TavilyExtractResult[]> => {
    const byNormalized = new Map(urls.map((u) => [normalizeUrl(u), u]));
    const normalizedKeys = Array.from(byNormalized.keys());
    const now = new Date();

    const cached = normalizedKeys.length
      ? await db
          .select()
          .from(sourceCache)
          .where(
            and(
              eq(sourceCache.workspaceId, workspaceId),
              inArray(sourceCache.urlNormalized, normalizedKeys),
              gte(sourceCache.expiresAt, now),
            ),
          )
      : [];
    const cachedByUrl = new Map(cached.map((c) => [c.urlNormalized, c]));

    const hits: TavilyExtractResult[] = [];
    const missing: string[] = [];
    for (const [normalized, original] of byNormalized) {
      const hit = cachedByUrl.get(normalized);
      if (hit?.contentText) {
        hits.push({ url: original, raw_content: hit.contentText });
      } else {
        missing.push(original);
      }
    }

    let fetched: TavilyExtractResult[] = [];
    if (missing.length > 0) {
      fetched = (await search.extract(missing)).results;
      const expiresAt = new Date(now.getTime() + ttlHours * 3600 * 1000);
      for (const r of fetched) {
        const text = r.raw_content ?? r.content ?? r.text ?? '';
        if (!text) continue;
        await db
          .insert(sourceCache)
          .values({
            workspaceId,
            urlNormalized: normalizeUrl(r.url),
            contentText: text,
            fetchedAt: now,
            expiresAt,
          })
          .onConflictDoUpdate({
            target: [sourceCache.workspaceId, sourceCache.urlNormalized],
            set: { contentText: text, fetchedAt: now, expiresAt },
          });
      }
    }
    return [...hits, ...fetched];
  };
}

/**
 * Registra as chamadas LLM de um item com custo estimado (um insert só).
 *
 * A tabela de preços vem do catálogo sincronizado e é buscada aqui, não
 * recebida por parâmetro: são cinco chamadores, e um que esquecesse de passar
 * voltaria a gravar custo NULL em silêncio. `getPriceTable` é cacheada.
 */
export async function recordLlmCalls(
  db: Db,
  workspaceId: string,
  runId: string,
  runItemId: string | null,
  calls: LlmCallRecord[],
) {
  if (calls.length === 0) return;
  const prices = await getPriceTable(db);
  await db.insert(llmCalls).values(
    calls.map((c) => {
      // custo real do provedor (OpenRouter) quando disponível; senão o catálogo
      const cost = c.costUsd ?? estimateCostUsd(c.model, c.inputTokens, c.outputTokens, prices);
      return {
        workspaceId,
        runId,
        runItemId,
        purpose: c.purpose,
        provider: c.provider,
        model: c.model,
        inputTokens: c.inputTokens,
        outputTokens: c.outputTokens,
        costEstimateUsd: cost === null ? null : cost.toFixed(6),
        durationMs: c.durationMs,
        status: c.status,
      };
    }),
  );
}

/** Marca o run como concluído quando todos os itens esperados foram registrados. */
export async function maybeFinalizeRun(db: Db, runId: string) {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run || run.status !== 'running' || run.expectedItems === null) return;

  const [{ total }] = (await db
    .select({ total: count() })
    .from(runItems)
    .where(eq(runItems.runId, runId))) as [{ total: number }];
  if (Number(total) < run.expectedItems) return;

  const items = await db.select({ status: runItems.status }).from(runItems).where(eq(runItems.runId, runId));
  const counts: Record<string, number> = {};
  for (const i of items) counts[i.status] = (counts[i.status] ?? 0) + 1;

  const failures = (counts.llm_failed ?? 0) + (counts.wp_failed ?? 0) + (counts.failed ?? 0) + (counts.validation_failed ?? 0);
  const successes = (counts.updated ?? 0) + (counts.created ?? 0) + (counts.no_change ?? 0) + (counts.skipped_sources_unchanged ?? 0);
  const status = failures === 0 ? 'success' : successes === 0 ? 'failed' : 'partial';

  const [tokens] = await db
    .select({
      tokensIn: sql<number>`coalesce(sum(${llmCalls.inputTokens}), 0)`,
      tokensOut: sql<number>`coalesce(sum(${llmCalls.outputTokens}), 0)`,
      cost: sql<string>`coalesce(sum(${llmCalls.costEstimateUsd}), 0)`,
    })
    .from(llmCalls)
    .where(eq(llmCalls.runId, runId));

  await db
    .update(runs)
    .set({
      status,
      finishedAt: new Date(),
      stats: {
        ...counts,
        tokensIn: Number(tokens?.tokensIn ?? 0),
        tokensOut: Number(tokens?.tokensOut ?? 0),
        costEstimateUsd: Number(tokens?.cost ?? 0),
      },
    })
    .where(and(eq(runs.id, runId), eq(runs.status, 'running')));
}
