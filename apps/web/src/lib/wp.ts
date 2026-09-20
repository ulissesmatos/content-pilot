import { UserFacingError } from '@/lib/errors';
import { and, credentials, eq, getTenantDb, sites } from '@content-pilot/db';
import { trackUsage, WordPressAdapter, type WordPressCredentials } from '@content-pilot/core';
import { markCredentialUsed } from '@/lib/credential-usage';
import { decryptSecret } from '@/lib/vault';

/**
 * Monta o adapter WordPress de um site do workspace (credencial descriptografada).
 * Fonte única para as actions da web (publicar pauta, restaurar conteúdo...).
 */
export async function getWordPressForSite(workspaceId: string, siteId: string): Promise<WordPressAdapter> {
  const db = getTenantDb(workspaceId);
  const [site] = await db
    .select()
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.workspaceId, workspaceId)))
    .limit(1);
  if (!site) throw new UserFacingError('Site não encontrado.');
  if (!site.credentialId) throw new UserFacingError('Site sem credencial.');

  const [cred] = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.id, site.credentialId), eq(credentials.workspaceId, workspaceId)))
    .limit(1);
  if (!cred) throw new UserFacingError('Credencial do site não encontrada.');

  const wpCreds = decryptSecret<WordPressCredentials>(cred.ciphertext, workspaceId, cred.id);
  // o uso é registrado quando o WordPress respondeu, não quando a credencial foi carregada
  return trackUsage(new WordPressAdapter(site.baseUrl, wpCreds), () => void markCredentialUsed(workspaceId, cred.id));
}
