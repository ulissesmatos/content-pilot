import { canUsePlatformKeys } from './platform-access';
import {
  and,
  contentTemplates,
  credentials,
  eq,
  getWorkspaceAiSettings,
  isNull,
  or,
  sites,
  type Db,
  type LlmPurpose,
} from '@content-pilot/db';
import {
  credentialVaultScope,
  HttpLlmProvider,
  OpenAiImageGenClient,
  TavilyClient,
  WordPressAdapter,
  parseTemplateConfig,
  type ImageGenClient,
  type LlmProvider,
  type LlmProviderName,
  type SearchClient,
  type TemplateConfig,
  type WordPressCredentials,
} from '@content-pilot/core';
import { decryptSecret } from './vault';

/** Resolução de site/credenciais/template a partir do banco — usada pelo CLI e pelas filas. */

export async function resolveSite(db: Db, ref?: string) {
  const rows = await db.select().from(sites).limit(50);
  if (rows.length === 0) throw new Error('Nenhum site cadastrado — crie um em /sites no painel.');
  if (!ref) {
    if (rows.length === 1) return rows[0]!;
    throw new Error(`Vários sites cadastrados — informe --site. Opções: ${rows.map((s) => s.name).join(', ')}`);
  }
  const found = rows.find((s) => s.id === ref || s.name.toLowerCase() === ref.toLowerCase());
  if (!found) throw new Error(`Site "${ref}" não encontrado.`);
  return found;
}

export async function resolveWordPressAdapter(db: Db, site: typeof sites.$inferSelect) {
  if (!site.credentialId) throw new Error(`Site "${site.name}" sem credencial associada.`);
  const [cred] = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.id, site.credentialId), eq(credentials.workspaceId, site.workspaceId)))
    .limit(1);
  if (!cred) throw new Error('Credencial do site não encontrada.');
  const wpCreds = decryptSecret<WordPressCredentials>(cred.ciphertext, site.workspaceId, cred.id);
  return new WordPressAdapter(site.baseUrl, wpCreds);
}

export async function resolveTemplate(db: Db, workspaceId: string, slugOrId: string): Promise<{ id: string; slug: string; config: TemplateConfig }> {
  const [row] = await db
    .select()
    .from(contentTemplates)
    .where(
      and(
        or(eq(contentTemplates.slug, slugOrId), eq(contentTemplates.id, slugOrId)),
        or(eq(contentTemplates.workspaceId, workspaceId), isNull(contentTemplates.workspaceId)),
      ),
    )
    .orderBy(contentTemplates.workspaceId) // clone do workspace vence o builtin
    .limit(1);
  if (!row) throw new Error(`Template "${slugOrId}" não encontrado.`);
  return { id: row.id, slug: row.slug, config: parseTemplateConfig(row.config) };
}

/** Template por id, restrito ao workspace dono ou builtin — nunca template de outro tenant. */
export async function resolveTemplateById(db: Db, templateId: string, workspaceId: string): Promise<{ id: string; slug: string; config: TemplateConfig }> {
  const [row] = await db
    .select()
    .from(contentTemplates)
    .where(
      and(
        eq(contentTemplates.id, templateId),
        or(eq(contentTemplates.workspaceId, workspaceId), isNull(contentTemplates.workspaceId)),
      ),
    )
    .limit(1);
  if (!row) throw new Error(`Template ${templateId} não encontrado.`);
  return { id: row.id, slug: row.slug, config: parseTemplateConfig(row.config) };
}

/** Só a credencial PRÓPRIA do workspace — sem cascata para a chave da plataforma. */
async function ownCredentialOfType(db: Db, workspaceId: string, type: string) {
  const [own] = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.workspaceId, workspaceId), eq(credentials.type, type as never)))
    .limit(1);
  return own ?? null;
}

/**
 * BYOK primeiro. Somente o workspace exclusivo do proprietário (ADMIN_EMAIL)
 * pode usar as chaves do sistema como alternativa. Falta de chave nos demais
 * workspaces encerra a operação, independentemente de plano ou isenção.
 */
async function firstCredentialOfType(db: Db, workspaceId: string, type: string) {
  const own = await ownCredentialOfType(db, workspaceId, type);
  if (own) return own;
  if (!await canUsePlatformKeys(db, workspaceId)) return null;
  const [platform] = await db
    .select()
    .from(credentials)
    .where(and(isNull(credentials.workspaceId), eq(credentials.type, type as never)))
    .limit(1);
  return platform ?? null;
}

/** Modelo padrão por provedor quando o fallback automático troca de provedor sem o cliente ter escolhido um modelo. */
const BYOK_FALLBACK_MODEL: Record<LlmProviderName, { text: string; vision: string }> = {
  openai: { text: 'gpt-4.1-mini', vision: 'gpt-4.1-mini' },
  anthropic: { text: 'claude-sonnet-4-5', vision: 'claude-haiku-4-5' },
  openrouter: { text: 'z-ai/glm-5.2', vision: 'openai/gpt-4o-mini' },
};

function byokDefaultModel(provider: LlmProviderName, purpose: LlmPurpose | undefined): string {
  return BYOK_FALLBACK_MODEL[provider][purpose === 'illustrate' ? 'vision' : 'text'];
}

/**
 * Alguma OUTRA credencial de IA própria do workspace, preferindo OpenAI (o
 * caso pedido: sem chave OpenRouter mas com chave OpenAI usa tudo via OpenAI).
 */
async function firstOtherOwnLlmCredential(db: Db, workspaceId: string, exclude: LlmProviderName) {
  const order: LlmProviderName[] = ['openai', 'anthropic', 'openrouter'];
  for (const provider of order) {
    if (provider === exclude) continue;
    const cred = await ownCredentialOfType(db, workspaceId, provider);
    if (cred) return { cred, provider };
  }
  return null;
}

function decryptApiKey(cred: { ciphertext: string; workspaceId: string | null; id: string }): string {
  const { apiKey } = decryptSecret<{ apiKey: string }>(
    cred.ciphertext,
    credentialVaultScope(cred.workspaceId),
    cred.id,
  );
  return apiKey;
}

export async function resolveSearchClient(db: Db, workspaceId: string): Promise<SearchClient> {
  const cred = await firstCredentialOfType(db, workspaceId, 'tavily');
  if (!cred) throw new Error('Nenhuma credencial Tavily disponível — cadastre sua própria chave em /credentials.');
  return new TavilyClient(decryptApiKey(cred));
}

export interface LlmTaskConfig {
  provider: LlmProviderName;
  model: string;
  credentialId?: string;
  maxTokens?: number;
  /** Usada só para escolher o modelo padrão do fallback automático (illustrate exige visão). */
  purpose?: LlmPurpose;
}

/**
 * Resolve provedor/modelo/credencial de uma etapa do pipeline.
 *
 * Ordem de decisão:
 * 1. `credentialId` explícito (fluxo antigo, intocado).
 * 2. Preferência do próprio workspace (`workspace_ai_settings`, só tem efeito
 *    em BYOK): se o cliente escolheu provedor+modelo e AINDA tem a credencial
 *    daquele provedor, essa escolha vale — mesmo que o perfil do admin
 *    aponte para outro provedor.
 * 3. Provedor do perfil do admin: credencial própria do workspace, com
 *    cascata para a chave da plataforma quando permitido (comportamento de
 *    sempre).
 * 4. Fallback automático: nenhuma credencial (própria ou de plataforma) para
 *    o provedor do perfil, mas o workspace tem OUTRA credencial de IA própria
 *    — usa essa, com o modelo que o cliente escolheu para ela (se bater) ou
 *    um modelo padrão razoável. É o caso pedido: sem chave OpenRouter mas com
 *    chave OpenAI, o pipeline continua rodando via OpenAI.
 */
export async function resolveLlmProvider(db: Db, workspaceId: string, task: LlmTaskConfig): Promise<LlmProvider> {
  if (task.credentialId) {
    // Even an explicit global credential ID must pass the owner check.
    const allowPlatform = await canUsePlatformKeys(db, workspaceId);
    const [cred] = await db
      .select()
      .from(credentials)
      .where(
        and(
          eq(credentials.id, task.credentialId),
          allowPlatform
            ? or(eq(credentials.workspaceId, workspaceId), isNull(credentials.workspaceId))
            : eq(credentials.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!cred) throw new Error('Credencial indisponível para este workspace/provedor.');
    if (cred.type !== task.provider) throw new Error('Credencial indisponível para este workspace/provedor.');
    return new HttpLlmProvider({
      provider: task.provider,
      model: task.model,
      apiKey: decryptApiKey(cred),
      maxTokensCap: task.maxTokens,
      openrouter: task.provider === 'openrouter' ? { appName: 'Content Pilot' } : undefined,
    });
  }

  let provider = task.provider;
  let model = task.model;

  const override = await getWorkspaceAiSettings(db, workspaceId);
  if (override?.provider && override.model) {
    const chosenCred = await ownCredentialOfType(db, workspaceId, override.provider);
    if (chosenCred) {
      provider = override.provider;
      model = override.model;
    }
    // credencial escolhida foi removida: ignora a preferência e segue o fluxo abaixo
  }

  let cred =
    provider === task.provider
      ? await firstCredentialOfType(db, workspaceId, provider)
      : await ownCredentialOfType(db, workspaceId, provider); // preferência explícita nunca cai para a chave da plataforma

  if (!cred) {
    const fallback = await firstOtherOwnLlmCredential(db, workspaceId, provider);
    if (fallback) {
      cred = fallback.cred;
      provider = fallback.provider;
      model =
        override?.provider === provider && override.model ? override.model : byokDefaultModel(provider, task.purpose);
    }
  }

  if (cred && cred.type !== provider) {
    throw new Error('Credencial indisponível para este workspace/provedor.');
  }
  if (!cred) throw new Error(`Nenhuma credencial ${task.provider} disponível — cadastre sua própria chave em /credentials.`);
  return new HttpLlmProvider({
    provider,
    model,
    apiKey: decryptApiKey(cred),
    maxTokensCap: task.maxTokens,
    openrouter: provider === 'openrouter' ? { appName: 'Content Pilot' } : undefined,
  });
}

/**
 * Provedor de geração de imagem (fallback do `illustrate`): exige credencial
 * OpenAI PRÓPRIA do workspace, mesmo que o texto use outro provedor — nunca
 * cai para a chave da plataforma. null quando não há chave OpenAI própria ou
 * o cliente não configurou um modelo de geração (`workspace_ai_settings`).
 */
export async function resolveImageGenProvider(db: Db, workspaceId: string): Promise<ImageGenClient | null> {
  const settings = await getWorkspaceAiSettings(db, workspaceId);
  if (!settings?.imageGenModel) return null;
  const cred = await ownCredentialOfType(db, workspaceId, 'openai');
  if (!cred) return null;
  return new OpenAiImageGenClient(decryptApiKey(cred), settings.imageGenModel);
}
