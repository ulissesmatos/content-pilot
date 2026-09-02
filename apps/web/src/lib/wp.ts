import { and, credentials, eq, getDb, sites } from '@content-pilot/db';
import { WordPressAdapter, type WordPressCredentials } from '@content-pilot/core';
import { decryptSecret } from '@/lib/vault';

/**
 * Monta o adapter WordPress de um site do workspace (credencial descriptografada).
 * Fonte única para as actions da web (publicar pauta, restaurar conteúdo...).
 */
export async function getWordPressForSite(workspaceId: string, siteId: string): Promise<WordPressAdapter> {
  const db = getDb();
  const [site] = await db
    .select()
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.workspaceId, workspaceId)))
    .limit(1);
  if (!site) throw new Error('Site não encontrado.');
  if (!site.credentialId) throw new Error('Site sem credencial.');

  const [cred] = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.id, site.credentialId), eq(credentials.workspaceId, workspaceId)))
    .limit(1);
  if (!cred) throw new Error('Credencial do site não encontrada.');

  const wpCreds = decryptSecret<WordPressCredentials>(cred.ciphertext, workspaceId, cred.id);
  return new WordPressAdapter(site.baseUrl, wpCreds);
}
