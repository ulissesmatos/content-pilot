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
  normalizeProviderModel,
  fetchAnthropicModels,
  fetchOpenAiModels,
  fetchOpenRouterModels,
  HttpError,
  HttpLlmProvider,
  OpenAiImageGenClient,
  TavilyClient,
  WordPressAdapter,
  parseTemplateConfig,
  type CatalogModel,
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

/** Chave do sistema, isolada das chaves BYOK. Só é chamada após a autorização do dono. */
async function platformCredentialOfType(db: Db, type: string) {
  const [platform] = await db
    .select()
    .from(credentials)
    .where(and(isNull(credentials.workspaceId), eq(credentials.type, type as never)))
    .limit(1);
  return platform ?? null;
}

/** Modelo padrão por provedor quando o workspace ainda não escolheu um modelo BYOK. */
const BYOK_FALLBACK_MODEL: Record<LlmProviderName, { text: string; vision: string }> = {
  openai: { text: 'gpt-4.1-mini', vision: 'gpt-4.1-mini' },
  anthropic: { text: 'claude-sonnet-4-5', vision: 'claude-haiku-4-5' },
  openrouter: { text: 'z-ai/glm-5.2', vision: 'openai/gpt-4o-mini' },
};

function byokDefaultModel(provider: LlmProviderName, purpose: LlmPurpose | undefined): string {
  return BYOK_FALLBACK_MODEL[provider][purpose === 'illustrate' ? 'vision' : 'text'];
}

/** A escolha automática de BYOK é determinística e privilegia OpenAI. */
async function preferredOwnLlmCredential(db: Db, workspaceId: string) {
  const order: LlmProviderName[] = ['openai', 'anthropic', 'openrouter'];
  for (const provider of order) {
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
  /** Usada para escolher o modelo BYOK padrão (illustrate exige visão). */
  purpose?: LlmPurpose;
}

/**
 * Resolve provedor/modelo/credencial de uma etapa do pipeline.
 *
 * Ordem de decisão:
 * 1. `credentialId` explícito (legado, com isolamento de tenant).
 * 2. BYOK explícito do workspace. O provedor e o modelo escolhidos são
 *    invariáveis: nunca há fallback OpenAI → OpenRouter (ou o inverso).
 * 3. BYOK sem escolha explícita: primeira chave própria na ordem OpenAI,
 *    Anthropic, OpenRouter, com modelo nativo padrão.
 * 4. Chave/perfil do sistema somente para o super admin, quando ele desligou
 *    a prioridade BYOK — ou quando não possui nenhuma chave própria. Falta de
 *    chave do sistema sempre retorna ao BYOK, jamais a outro provedor.
 */
interface ResolvedLlmCredential {
  provider: LlmProviderName;
  model: string;
  apiKey: string;
}

/**
 * Resolve exclusivamente uma chave do workspace. Não há fallback entre a
 * escolha explícita do usuário e outro provedor: OpenAI escolhido jamais vira
 * OpenRouter por falta/erro de chave.
 */
async function resolveByokLlmCredential(
  db: Db,
  workspaceId: string,
  task: LlmTaskConfig,
  override: Awaited<ReturnType<typeof getWorkspaceAiSettings>>,
): Promise<ResolvedLlmCredential> {
  if (override?.provider && override.model) {
    const cred = await ownCredentialOfType(db, workspaceId, override.provider);
    if (!cred) {
      throw new Error(
        `A preferência BYOK usa ${override.provider}, mas essa chave foi removida. Cadastre-a novamente ou altere a preferência em /credentials.`,
      );
    }
    const fixed = normalizeProviderModel(override.provider, override.model);
    return { provider: fixed.provider, model: fixed.modelId, apiKey: decryptApiKey(cred) };
  }

  const fallback = await preferredOwnLlmCredential(db, workspaceId);
  if (!fallback) {
    throw new Error('Nenhuma credencial BYOK de IA disponível — cadastre uma chave OpenAI, Anthropic ou OpenRouter em /credentials.');
  }
  const fixed = normalizeProviderModel(fallback.provider, byokDefaultModel(fallback.provider, task.purpose));
  return { provider: fixed.provider, model: fixed.modelId, apiKey: decryptApiKey(fallback.cred) };
}

async function resolveLlmCredential(db: Db, workspaceId: string, task: LlmTaskConfig): Promise<ResolvedLlmCredential> {
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
    const fixed = normalizeProviderModel(task.provider, task.model);
    return { provider: fixed.provider, model: fixed.modelId, apiKey: decryptApiKey(cred) };
  }

  const override = await getWorkspaceAiSettings(db, workspaceId);
  const canUseSystem = await canUsePlatformKeys(db, workspaceId);

  // As chaves do sistema são um modo separado, exclusivo do dono. Mesmo para
  // ele, BYOK é a prioridade padrão; desligar o toggle permite optar pelo
  // perfil do sistema. Se a chave configurada no perfil não existir, o BYOK
  // continua intacto e é a única reserva permitida.
  if (canUseSystem && override?.preferOwnKeys === false) {
    const systemCredential = await platformCredentialOfType(db, task.provider);
    if (systemCredential) {
      const fixed = normalizeProviderModel(task.provider, task.model);
      return { provider: fixed.provider, model: fixed.modelId, apiKey: decryptApiKey(systemCredential) };
    }
  }

  try {
    return await resolveByokLlmCredential(db, workspaceId, task, override);
  } catch (err) {
    // Sem nenhuma escolha/chave BYOK, o dono ainda pode usar o sistema no
    // modo padrão. Uma preferência BYOK explícita nunca recebe esse fallback:
    // assim um toggle ligado realmente impede que a chave do sistema a
    // substitua.
    if (!override?.provider && canUseSystem) {
      const systemCredential = await platformCredentialOfType(db, task.provider);
      if (systemCredential) {
        const fixed = normalizeProviderModel(task.provider, task.model);
        return { provider: fixed.provider, model: fixed.modelId, apiKey: decryptApiKey(systemCredential) };
      }
    }
    throw err;
  }
}

export async function resolveLlmProvider(db: Db, workspaceId: string, task: LlmTaskConfig): Promise<LlmProvider> {
  const { provider, model, apiKey } = await resolveLlmCredential(db, workspaceId, task);
  return new HttpLlmProvider({
    provider,
    model,
    apiKey,
    maxTokensCap: task.maxTokens,
    openrouter: provider === 'openrouter' ? { appName: 'Content Pilot' } : undefined,
  });
}

/** Uma etapa nomeada para o preflight — o nome é o que aparece na mensagem de erro. */
export interface PreflightLlmTask extends LlmTaskConfig {
  label: string;
}

/**
 * Confere ANTES de gastar qualquer chamada de busca/geração que o modelo
 * configurado existe de fato na conta do provedor resolvido — sem gastar
 * tokens: usa a mesma listagem de modelos do catálogo (grátis em todo
 * provedor). Só assim um "openai/gpt-5.4-nano" copiado errado do formato do
 * OpenRouter para um perfil provider=openai é pego antes da busca rodar, em
 * vez de estourar HTTP 400 no meio do job já com Tavily gasto.
 *
 * Erro de rede/instabilidade ao buscar o catálogo NUNCA vira falha aqui — só
 * bloqueia quando a lista responde e o modelo comprovadamente não está nela,
 * ou quando a chave é rejeitada (401/403). Instabilidade momentânea do
 * endpoint de listagem não pode derrubar um job que talvez rodasse bem.
 */
export async function preflightLlmTasks(
  db: Db,
  workspaceId: string,
  tasks: PreflightLlmTask[],
): Promise<string[]> {
  const issues: string[] = [];
  await Promise.all(
    tasks.map(async (task) => {
      let resolved: ResolvedLlmCredential;
      try {
        resolved = await resolveLlmCredential(db, workspaceId, task);
      } catch (err) {
        issues.push(`${task.label}: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      let models: CatalogModel[];
      try {
        models =
          resolved.provider === 'openai'
            ? await fetchOpenAiModels(resolved.apiKey, { timeoutMs: 10_000 })
            : resolved.provider === 'anthropic'
              ? await fetchAnthropicModels(resolved.apiKey, { timeoutMs: 10_000 })
              : await fetchOpenRouterModels({ timeoutMs: 10_000 }); // pública — não valida a chave, só o id do modelo
      } catch (err) {
        if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
          issues.push(`${task.label}: chave ${resolved.provider} rejeitada pelo provedor (${err.status}) — verifique em /credentials.`);
        }
        // qualquer outro erro (timeout, 5xx, instabilidade) não bloqueia — não dá pra confirmar, mas também não dá pra culpar a config
        return;
      }
      if (!models.some((m) => m.modelId === resolved.model)) {
        issues.push(
          `${task.label}: modelo "${resolved.model}" não existe na conta ${resolved.provider} — corrija em /admin/ai/profiles ou em /credentials.`,
        );
      }
    }),
  );
  return issues;
}

/**
 * Provedor de geração de imagem (fallback do `illustrate`): exige credencial
 * OpenAI do workspace, mesmo que o texto use outro provedor. Só o super admin
 * com prioridade BYOK desligada pode usar a chave OpenAI do sistema. null
 * quando não há chave permitida ou modelo de geração configurado.
 */
export async function resolveImageGenProvider(db: Db, workspaceId: string): Promise<ImageGenClient | null> {
  const settings = await getWorkspaceAiSettings(db, workspaceId);
  if (!settings?.imageGenModel) return null;
  const canUseSystem = await canUsePlatformKeys(db, workspaceId);
  const cred =
    canUseSystem && settings.preferOwnKeys === false
      ? (await platformCredentialOfType(db, 'openai')) ?? (await ownCredentialOfType(db, workspaceId, 'openai'))
      : (await ownCredentialOfType(db, workspaceId, 'openai')) ??
        (canUseSystem ? await platformCredentialOfType(db, 'openai') : null);
  if (!cred) return null;
  return new OpenAiImageGenClient(decryptApiKey(cred), settings.imageGenModel);
}
