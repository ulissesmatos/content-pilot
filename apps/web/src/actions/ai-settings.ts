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
  checkProviderModel,
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
    preferOwnKeys: z.boolean(),
  })
  .refine((v) => (v.provider === null) === (v.model === null), {
    message: 'Escolha provedor e modelo juntos, ou limpe os dois.',
  });

/** Provedor/modelo ativo para texto e visão. null/null escolhe a primeira chave BYOK (OpenAI primeiro). */
export async function saveAiSettingsAction(input: unknown): Promise<ActionResult<null>> {
  return runAuthedAction(saveAiSettingsSchema, input, async (data, { workspaceId }) => {
    let model = data.model;
    if (data.provider) {
      const cred = await ownCredential(workspaceId, data.provider);
      if (!cred) throw new UserFacingError('Cadastre a credencial deste provedor antes de ativá-lo.');
      // Mesmo tratamento do perfil do admin: prefixo que repete o provedor
      // sai fora; id de outro fornecedor não tem equivalente nativo.
      const check = checkProviderModel(data.provider, data.model ?? '');
      if (check.fix === 'foreign-vendor') {
        throw new UserFacingError(
          `"${data.model}" é um modelo da ${check.vendor} no formato do OpenRouter. Escolha um modelo do provedor selecionado ou troque para OpenRouter.`,
        );
      }
      model = check.modelId;

      // Confere contra a PRÓPRIA chave do usuário. É o único lugar onde essa
      // pergunta tem resposta autoritativa: o model_catalog é da instalação e
      // não enxerga a conta dele. Instabilidade da API não impede de salvar —
      // recusar um modelo válido por causa de um timeout seria pior.
      try {
        const models =
          data.provider === 'openai'
            ? await fetchOpenAiModels(apiKeyOf(cred, workspaceId))
            : data.provider === 'anthropic'
              ? await fetchAnthropicModels(apiKeyOf(cred, workspaceId))
              : await fetchOpenRouterModels();
        if (models.length > 0 && !models.some((m) => m.modelId === model)) {
          throw new UserFacingError(
            `"${model}" não aparece entre os modelos da sua conta ${data.provider === 'openai' ? 'OpenAI' : data.provider === 'anthropic' ? 'Anthropic' : 'OpenRouter'}. Escolha um da lista.`,
          );
        }
      } catch (err) {
        if (err instanceof UserFacingError) throw err;
        console.warn('[ai-settings] não foi possível conferir o modelo na conta do usuário', err);
      }
    }
    const db = getTenantDb(workspaceId);
    const current = await getWorkspaceAiSettings(db, workspaceId);
    await upsertWorkspaceAiSettings(db, workspaceId, {
      provider: data.provider,
      model,
      preferOwnKeys: data.preferOwnKeys,
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
      try {
        const models = await fetchOpenAiImageModels(apiKeyOf(cred, workspaceId));
        if (models.length > 0 && !models.some((m) => m.modelId === data.imageGenModel)) {
          throw new UserFacingError(
            `"${data.imageGenModel}" não aparece entre os modelos de imagem da sua conta OpenAI. Escolha um da lista.`,
          );
        }
      } catch (err) {
        if (err instanceof UserFacingError) throw err;
        console.warn('[ai-settings] não foi possível conferir o modelo de imagem na conta do usuário', err);
      }
    }
    const db = getTenantDb(workspaceId);
    const current = await getWorkspaceAiSettings(db, workspaceId);
    await upsertWorkspaceAiSettings(db, workspaceId, {
      provider: current?.provider ?? null,
      model: current?.model ?? null,
      preferOwnKeys: current?.preferOwnKeys ?? true,
      imageGenModel: data.imageGenModel,
    });
    revalidatePath('/credentials');
    return null;
  });
}
