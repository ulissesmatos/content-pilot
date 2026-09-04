import { eq, isNotNull, or } from 'drizzle-orm';
import type { Db } from '../client';
import { modelCatalog } from '../schema';
import { cachedConfig } from '../config-cache';

/**
 * Tabela de preços vinda do catálogo sincronizado, no formato que o
 * `estimateCostUsd` do core espera (USD por 1M de tokens).
 *
 * Indexada pelo id completo E pelo id seco: o mesmo modelo aparece como
 * "openai/gpt-4o" no OpenRouter e "gpt-4o" na chamada nativa, e as duas
 * grafias precisam encontrar preço.
 */
export type PriceTable = Record<string, { input: number; output: number }>;

export async function getPriceTable(db: Db): Promise<PriceTable> {
  return cachedConfig(db, 'price-table', async () => {
    const rows = await db
      .select({
        modelId: modelCatalog.modelId,
        input: modelCatalog.inputPricePerMtok,
        output: modelCatalog.outputPricePerMtok,
      })
      .from(modelCatalog)
      .where(or(isNotNull(modelCatalog.inputPricePerMtok), isNotNull(modelCatalog.outputPricePerMtok)));

    const table: PriceTable = {};
    for (const row of rows) {
      const input = Number(row.input ?? 0);
      const output = Number(row.output ?? 0);
      if (!Number.isFinite(input) && !Number.isFinite(output)) continue;
      const entry = { input: Number.isFinite(input) ? input : 0, output: Number.isFinite(output) ? output : 0 };
      table[row.modelId] = entry;
      const bare = row.modelId.split('/').pop();
      // o id completo tem precedência: só preenche o seco se ninguém ocupou
      if (bare && bare !== row.modelId && !table[bare]) table[bare] = entry;
    }
    return table;
  });
}
