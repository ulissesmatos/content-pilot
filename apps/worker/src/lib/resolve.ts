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
  const [cred] = await db.select().from(credentials).where(eq(credentials.id, site.credentialId)).limit(1);
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

export async function resolveTemplateById(db: Db, templateId: string): Promise<{ id: string; slug: string; config: TemplateConfig }> {
  const [row] = await db.select().from(contentTemplates).where(eq(contentTemplates.id, templateId)).limit(1);
  if (!row) throw new Error(`Template ${templateId} não encontrado.`);
  return { id: row.id, slug: row.slug, config: parseTemplateConfig(row.config) };
}

async function firstCredentialOfType(db: Db, workspaceId: string, type: string) {
  const [cred] = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.workspaceId, workspaceId), eq(credentials.type, type as never)))
    .limit(1);
  return cred ?? null;
}

export async function resolveSearchClient(db: Db, workspaceId: string): Promise<SearchClient> {
  const cred = await firstCredentialOfType(db, workspaceId, 'tavily');
  if (!cred) throw new Error('Nenhuma credencial Tavily cadastrada — adicione em /credentials.');
  const { apiKey } = decryptSecret<{ apiKey: string }>(cred.ciphertext, workspaceId, cred.id);
  return new TavilyClient(apiKey);
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
    [cred] = await db
      .select()
      .from(credentials)
      .where(and(eq(credentials.id, task.credentialId), eq(credentials.workspaceId, workspaceId)))
      .limit(1);
  } else {
    cred = await firstCredentialOfType(db, workspaceId, task.provider);
  }
  if (!cred) throw new Error(`Nenhuma credencial ${task.provider} cadastrada — adicione em /credentials.`);
  const { apiKey } = decryptSecret<{ apiKey: string }>(cred.ciphertext, workspaceId, cred.id);
  return new HttpLlmProvider({
    provider: task.provider,
    model: task.model,
    apiKey,
    maxTokensCap: task.maxTokens,
    openrouter: task.provider === 'openrouter' ? { appName: 'Content Pilot' } : undefined,
  });
}
