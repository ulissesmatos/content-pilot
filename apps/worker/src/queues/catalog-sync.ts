import {
  bumpConfigVersion,
  eq,
  inArray,
  modelCatalog,
  sql,
  type Db,
} from '@content-pilot/db';
import {
  fetchAnthropicModels,
  fetchOpenAiModels,
  fetchOpenRouterModels,
  matchOpenRouterPricing,
  type CatalogModel,
} from '@content-pilot/core';
import { readPlatformCredential } from '../lib/platform-secrets';

/**
 * Sincroniza o catálogo de modelos dos provedores.
 *
 * Roda de madrugada e também sob demanda pelo painel. Duas razões para
 * existir: o admin escolher modelo de uma lista real em vez de digitar um id,
 * e o preço por token virar dado — sem isso o custo de qualquer modelo fora
 * da tabela fixa do código fica NULL no banco.
 *
 * O OpenRouter é a espinha: endpoint público, traz preço e capacidades, e
 * lista também os modelos que se acessa direto na OpenAI/Anthropic.
 */

export interface CatalogSyncResult {
  fetched: number;
  upserted: number;
  markedUnavailable: number;
  providers: string[];
  errors: string[];
}

export async function syncModelCatalog(db: Db): Promise<CatalogSyncResult> {
  const errors: string[] = [];
  const providers: string[] = [];

  let openRouter: CatalogModel[] = [];
  try {
    openRouter = await fetchOpenRouterModels();
    providers.push('openrouter');
  } catch (err) {
    // sem o OpenRouter não há preço para ninguém — o resto continua, mas o
    // operador precisa saber por que o custo ficou desconhecido
    errors.push(`openrouter: ${err instanceof Error ? err.message : String(err)}`);
  }

  const native: CatalogModel[] = [];

  const openAiKey = await readPlatformCredential<{ apiKey?: string }>(db, 'openai');
  if (openAiKey?.apiKey) {
    try {
      native.push(...(await fetchOpenAiModels(openAiKey.apiKey)));
      providers.push('openai');
    } catch (err) {
      errors.push(`openai: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const anthropicKey = await readPlatformCredential<{ apiKey?: string }>(db, 'anthropic');
  if (anthropicKey?.apiKey) {
    try {
      native.push(...(await fetchAnthropicModels(anthropicKey.apiKey)));
      providers.push('anthropic');
    } catch (err) {
      errors.push(`anthropic: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // preço e capacidades dos nativos vêm do equivalente no OpenRouter
  const all = [...openRouter, ...matchOpenRouterPricing(native, openRouter)];
  if (all.length === 0) {
    return { fetched: 0, upserted: 0, markedUnavailable: 0, providers, errors };
  }

  const now = new Date();
  let upserted = 0;
  // lotes: a lista do OpenRouter passa de 300 modelos
  const CHUNK = 200;
  for (let i = 0; i < all.length; i += CHUNK) {
    const chunk = all.slice(i, i + CHUNK);
    await db
      .insert(modelCatalog)
      .values(
        chunk.map((m) => ({
          provider: m.provider,
          modelId: m.modelId,
          displayName: m.displayName,
          contextLength: m.contextLength,
          maxOutputTokens: m.maxOutputTokens,
          inputPricePerMtok: m.inputPricePerMtok === null ? null : m.inputPricePerMtok.toFixed(6),
          outputPricePerMtok: m.outputPricePerMtok === null ? null : m.outputPricePerMtok.toFixed(6),
          priceSource: m.priceSource,
          supportsVision: m.supportsVision,
          supportsStructuredOutput: m.supportsStructuredOutput,
          raw: m.raw as Record<string, unknown>,
          available: true,
          fetchedAt: now,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [modelCatalog.provider, modelCatalog.modelId],
        set: {
          displayName: sql`excluded.display_name`,
          contextLength: sql`excluded.context_length`,
          maxOutputTokens: sql`excluded.max_output_tokens`,
          inputPricePerMtok: sql`excluded.input_price_per_mtok`,
          outputPricePerMtok: sql`excluded.output_price_per_mtok`,
          priceSource: sql`excluded.price_source`,
          supportsVision: sql`excluded.supports_vision`,
          supportsStructuredOutput: sql`excluded.supports_structured_output`,
          raw: sql`excluded.raw`,
          available: sql`true`,
          fetchedAt: now,
          updatedAt: now,
        },
      });
    upserted += chunk.length;
  }

  // Modelo que sumiu do provedor vira indisponível, nunca é apagado: pode
  // haver perfil apontando para ele, e llm_calls antigos referenciam o id.
  let markedUnavailable = 0;
  for (const provider of providers) {
    const ids = all.filter((m) => m.provider === provider).map((m) => m.modelId);
    if (ids.length === 0) continue;
    const gone = await db
      .update(modelCatalog)
      .set({ available: false, updatedAt: now })
      .where(
        sql`${modelCatalog.provider} = ${provider} and ${modelCatalog.available} = true and ${modelCatalog.modelId} not in ${ids}`,
      )
      .returning({ id: modelCatalog.id });
    markedUnavailable += gone.length;
  }

  // a tabela de preços é cacheada por versão de config
  await bumpConfigVersion(db);

  return { fetched: all.length, upserted, markedUnavailable, providers, errors };
}

export async function handleCatalogSync(db: Db): Promise<void> {
  const result = await syncModelCatalog(db);
  console.log(
    `[catalog-sync] ${result.upserted} modelos de [${result.providers.join(', ') || 'nenhum provedor'}]` +
      (result.markedUnavailable ? `, ${result.markedUnavailable} marcados indisponíveis` : '') +
      (result.errors.length ? ` — erros: ${result.errors.join(' | ')}` : ''),
  );
}
