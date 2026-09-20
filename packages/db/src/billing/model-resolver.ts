import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../client';
import { modelProfileEntries, modelProfiles } from '../schema';
import { cachedConfig } from '../config-cache';

/**
 * Qual modelo usar em cada ponto do pipeline.
 *
 * A escolha é do ADMIN, não do cliente: o painel define um perfil (um modelo
 * por purpose) e o worker resolve na hora da execução. Com o modelo fixo, o
 * custo por post é conhecido de antemão — e é por isso que limitar por post
 * basta. Enquanto o cliente escolhia, um plano de US$ 79 podia consumir
 * centenas de dólares de IA.
 */

export type LlmPurpose = 'generate' | 'verify' | 'discover' | 'dedupe' | 'illustrate';
export type LlmProviderName = 'anthropic' | 'openai' | 'openrouter';

export interface ResolvedModel {
  provider: LlmProviderName;
  model: string;
  maxTokens?: number;
  profileSlug: string;
  purpose: LlmPurpose;
}

export interface ModelProfileWithEntries {
  id: string;
  slug: string;
  name: string;
  entries: Array<{
    purpose: LlmPurpose;
    provider: LlmProviderName;
    modelId: string;
    maxTokens: number | null;
  }>;
}

async function loadProfile(db: Db, slug: string | null): Promise<ModelProfileWithEntries | null> {
  const [profile] = await db
    .select({ id: modelProfiles.id, slug: modelProfiles.slug, name: modelProfiles.name })
    .from(modelProfiles)
    .where(
      slug
        ? and(eq(modelProfiles.slug, slug), isNull(modelProfiles.archivedAt))
        : and(eq(modelProfiles.isDefault, true), isNull(modelProfiles.archivedAt)),
    )
    .orderBy(asc(modelProfiles.slug))
    .limit(1);
  if (!profile) return null;

  const entries = await db
    .select({
      purpose: modelProfileEntries.purpose,
      provider: modelProfileEntries.provider,
      modelId: modelProfileEntries.modelId,
      maxTokens: modelProfileEntries.maxTokens,
    })
    .from(modelProfileEntries)
    .where(eq(modelProfileEntries.profileId, profile.id));

  return { ...profile, entries };
}

/** Perfil por slug (ou o default quando slug é null), cacheado. */
export async function getModelProfile(
  db: Db,
  slug: string | null = null,
): Promise<ModelProfileWithEntries | null> {
  return cachedConfig(db, `model-profile:${slug ?? '__default'}`, () => loadProfile(db, slug));
}

/**
 * Perfil que vale para um workspace.
 *
 * Hoje devolve sempre o default. É aqui que o Bloco 4 pluga a leitura do
 * plano (plans.model_profile_id) — deixar o ponto de extensão explícito evita
 * espalhar a decisão por cinco chamadores.
 */
export async function getProfileForWorkspace(
  db: Db,
  _workspaceId: string,
): Promise<ModelProfileWithEntries | null> {
  return getModelProfile(db, null);
}

export class ModelNotConfiguredError extends Error {
  constructor(purpose: LlmPurpose) {
    super(
      `Nenhum modelo configurado para "${purpose}". Defina o perfil padrão em /admin/ai/profiles.`,
    );
    this.name = 'ModelNotConfiguredError';
  }
}

/** Modelo a usar neste workspace para este purpose. */
export async function resolveTaskModel(
  db: Db,
  workspaceId: string,
  purpose: LlmPurpose,
): Promise<ResolvedModel> {
  const profile = await getProfileForWorkspace(db, workspaceId);
  const entry = profile?.entries.find((e) => e.purpose === purpose);
  if (!profile || !entry) throw new ModelNotConfiguredError(purpose);
  return {
    provider: entry.provider,
    model: entry.modelId,
    maxTokens: entry.maxTokens ?? undefined,
    profileSlug: profile.slug,
    purpose,
  };
}
