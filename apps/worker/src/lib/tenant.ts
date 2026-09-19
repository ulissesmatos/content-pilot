import { eq, workspaces, type Db } from '@content-pilot/db';

export async function assertWorkerWorkspace(db: Db, workspaceId: string): Promise<void> {
  const [workspace] = await db.select({ status: workspaces.status }).from(workspaces)
    .where(eq(workspaces.id, workspaceId)).limit(1);
  if (!workspace || workspace.status !== 'active') throw new Error('Workspace indisponível.');
}
