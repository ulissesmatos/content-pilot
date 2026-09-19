import { canUsePlatformKeys } from './platform-access';
import {
  and,
  contentTemplates,
  credentials,
  eq,
  isNull,
  or,
  sites,
  type Db,
} from '@content-pilot/db';
import {
  credentialVaultScope,
  HttpLlmProvider,
  TavilyClient,
  WordPressAdapter,
  parseTemplateConfig,
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

/**
 * BYOK primeiro. Somente o workspace exclusivo do proprietário (ADMIN_EMAIL)
 * pode usar as chaves do sistema como alternativa. Falta de chave nos demais
 * workspaces encerra a operação, independentemente de plano ou isenção.
 */
async function firstCredentialOfType(db: Db, workspaceId: string, type: string) {
  const [own] = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.workspaceId, workspaceId), eq(credentials.type, type as never)))
    .limit(1);
  if (own) return own;
  if (!await canUsePlatformKeys(db, workspaceId)) return null;
  const [platform] = await db
    .select()
    .from(credentials)
    .where(and(isNull(credentials.workspaceId), eq(credentials.type, type as never)))
    .limit(1);
  return platform ?? null;
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
}

export async function resolveLlmProvider(db: Db, workspaceId: string, task: LlmTaskConfig): Promise<LlmProvider> {
  let cred;
  if (task.credentialId) {
    // Even an explicit global credential ID must pass the owner check.
    const allowPlatform = await canUsePlatformKeys(db, workspaceId);
    [cred] = await db
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
  } else {
    cred = await firstCredentialOfType(db, workspaceId, task.provider);
  }
  if (cred && cred.type !== task.provider) {
    throw new Error('Credencial indisponível para este workspace/provedor.');
  }
  if (!cred) throw new Error(`Nenhuma credencial ${task.provider} disponível — cadastre sua própria chave em /credentials.`);
  return new HttpLlmProvider({
    provider: task.provider,
    model: task.model,
    apiKey: decryptApiKey(cred),
    maxTokensCap: task.maxTokens,
    openrouter: task.provider === 'openrouter' ? { appName: 'Content Pilot' } : undefined,
  });
}
