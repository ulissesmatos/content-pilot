'use server';

import { UserFacingError } from '@/lib/errors';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import {
  credentials,
  getTenantDb,
  getWorkspaceAiSettings,
  upsertWorkspaceAiSettings,
} from '@content-pilot/db';
import {
  fetchAnthropicModels,
  fetchOpenAiImageModels,
  fetchOpenAiModels,
  fetchOpenRouterModels,
  type CatalogModel,
} from '@content-pilot/core';
import { z } from 'zod';
import { runAuthedAction, type ActionResult } from '@/lib/action-utils';
import { decryptSecret } from '@/lib/vault';

/**
 * Escolha de provedor/modelo do próprio workspace (BYOK) — ver
 * `workspace_ai_settings` no schema e `resolveLlmProvider` no worker. Só faz
 * sentido para quem tem credencial própria: nunca lê/decripta a chave da
 * plataforma.
 */

const LLM_TYPES = ['anthropic', 'openai', 'openrouter'] as const;
type LlmType = (typeof LLM_TYPES)[number];

async function ownCredential(workspaceId: string, type: LlmType) {
  const [cred] = await getTenantDb(workspaceId)
    .select({ id: credentials.id, ciphertext: credentials.ciphertext })
    .from(credentials)
    .where(and(eq(credentials.workspaceId, workspaceId), eq(credentials.type, type)))
    .limit(1);
  return cred ?? null;
}

function apiKeyOf(cred: { ciphertext: string; id: string }, workspaceId: string): string {
  return decryptSecret<{ apiKey: string }>(cred.ciphertext, workspaceId, cred.id).apiKey;
}

export interface ModelOption {
  modelId: string;
  displayName: string;
  supportsVision: boolean;
}

function toOptions(models: CatalogModel[]): ModelOption[] {
  return models
    .map((m) => ({ modelId: m.modelId, displayName: m.displayName, supportsVision: m.supportsVision }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

const listModelsSchema = z.object({ provider: z.enum(LLM_TYPES) });

/** Modelos de texto/visão disponíveis na credencial PRÓPRIA do workspace para o provedor. */
export async function listProviderModelsAction(input: unknown): Promise<ActionResult<ModelOption[]>> {
  return runAuthedAction(listModelsSchema, input, async ({ provider }, { workspaceId }) => {
    const cred = await ownCredential(workspaceId, provider);
    if (!cred) throw new UserFacingError('Cadastre uma credencial própria deste provedor antes de escolher o modelo.');
    const apiKey = apiKeyOf(cred, workspaceId);
    try {
      const models =
        provider === 'openai'
          ? await fetchOpenAiModels(apiKey)
          : provider === 'anthropic'
            ? await fetchAnthropicModels(apiKey)
            : await fetchOpenRouterModels();
      return toOptions(models);
    } catch {
      throw new UserFacingError('Não foi possível buscar os modelos — verifique a chave e tente novamente.');
    }
  });
}

/** Modelos de geração de imagem (gpt-image-1/dall-e) na credencial OpenAI própria. */
export async function listImageGenModelsAction(): Promise<ActionResult<ModelOption[]>> {
  return runAuthedAction(z.object({}), {}, async (_data, { workspaceId }) => {
    const cred = await ownCredential(workspaceId, 'openai');
    if (!cred) throw new UserFacingError('Cadastre uma credencial OpenAI própria antes de ativar a geração de imagem.');
    const apiKey = apiKeyOf(cred, workspaceId);
    try {
      return toOptions(await fetchOpenAiImageModels(apiKey));
    } catch {
      throw new UserFacingError('Não foi possível buscar os modelos de imagem — verifique a chave e tente novamente.');
    }
  });
}

const saveAiSettingsSchema = z
  .object({
    provider: z.enum(LLM_TYPES).nullable(),
    model: z.string().min(1).max(200).nullable(),
  })
  .refine((v) => (v.provider === null) === (v.model === null), {
    message: 'Escolha provedor e modelo juntos, ou limpe os dois.',
  });

/** Provedor/modelo ativo para texto e visão. null/null volta ao padrão do admin. */
export async function saveAiSettingsAction(input: unknown): Promise<ActionResult<null>> {
  return runAuthedAction(saveAiSettingsSchema, input, async (data, { workspaceId }) => {
    if (data.provider) {
      const cred = await ownCredential(workspaceId, data.provider);
      if (!cred) throw new UserFacingError('Cadastre a credencial deste provedor antes de ativá-lo.');
    }
    const db = getTenantDb(workspaceId);
    const current = await getWorkspaceAiSettings(db, workspaceId);
    await upsertWorkspaceAiSettings(db, workspaceId, {
      provider: data.provider,
      model: data.model,
      imageGenModel: current?.imageGenModel ?? null,
    });
    revalidatePath('/credentials');
    return null;
  });
}

const saveImageGenSchema = z.object({ imageGenModel: z.string().min(1).max(200).nullable() });

/** Modelo de geração de imagem (fallback do illustrate). null desativa. */
export async function saveImageGenSettingsAction(input: unknown): Promise<ActionResult<null>> {
  return runAuthedAction(saveImageGenSchema, input, async (data, { workspaceId }) => {
    if (data.imageGenModel) {
      const cred = await ownCredential(workspaceId, 'openai');
      if (!cred) {
        throw new UserFacingError('Cadastre uma credencial OpenAI própria antes de ativar a geração de imagem.');
      }
    }
    const db = getTenantDb(workspaceId);
    const current = await getWorkspaceAiSettings(db, workspaceId);
    await upsertWorkspaceAiSettings(db, workspaceId, {
      provider: current?.provider ?? null,
      model: current?.model ?? null,
      imageGenModel: data.imageGenModel,
    });
    revalidatePath('/credentials');
    return null;
  });
}
