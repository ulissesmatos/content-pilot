import { and, credentials, eq, getTenantDb } from '@content-pilot/db';

/**
 * Registra o último uso REAL de uma credencial (o que /credentials mostra) quando o painel a usa
 * contra o provedor: listar modelos com a chave do usuário, falar com o WordPress. A geração
 * de conteúdo, que é o grosso do uso, registra no worker.
 *
 * Best-effort: falhar em anotar o uso nunca pode derrubar a ação do usuário.
 */
export async function markCredentialUsed(workspaceId: string, credentialId: string): Promise<void> {
  try {
    await getTenantDb(workspaceId)
      .update(credentials)
      .set({ lastUsedAt: new Date() })
      .where(and(eq(credentials.id, credentialId), eq(credentials.workspaceId, workspaceId)));
  } catch (err) {
    console.warn(`[credential-usage] não gravou o uso da credencial ${credentialId}:`, err);
  }
}
