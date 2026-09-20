import { eq } from 'drizzle-orm';
import type { Db } from '../client';
import { workspaceAiSettings } from '../schema';
import type { LlmProviderName } from './model-resolver';

/**
 * Preferência de IA do workspace (só tem efeito para BYOK — ver
 * `workspace-ai-settings.ts` do schema e `resolveWorkspaceLlmOverride` no
 * worker). Lida/gravada pelo painel em /credentials.
 */
export interface WorkspaceAiSettings {
  provider: LlmProviderName | null;
  model: string | null;
  imageGenModel: string | null;
}

export async function getWorkspaceAiSettings(db: Db, workspaceId: string): Promise<WorkspaceAiSettings | null> {
  const [row] = await db
    .select({
      provider: workspaceAiSettings.provider,
      model: workspaceAiSettings.model,
      imageGenModel: workspaceAiSettings.imageGenModel,
    })
    .from(workspaceAiSettings)
    .where(eq(workspaceAiSettings.workspaceId, workspaceId))
    .limit(1);
  return row ?? null;
}

export async function upsertWorkspaceAiSettings(
  db: Db,
  workspaceId: string,
  patch: WorkspaceAiSettings,
): Promise<void> {
  await db
    .insert(workspaceAiSettings)
    .values({ workspaceId, ...patch, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: workspaceAiSettings.workspaceId,
      set: { ...patch, updatedAt: new Date() },
    });
}
