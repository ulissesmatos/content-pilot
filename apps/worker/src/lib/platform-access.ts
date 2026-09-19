import { and, eq, isNull, users, workspaces, type Db } from '@content-pilot/db';

/**
 * System AI/search keys belong exclusively to the installation owner.
 * Plans, platform roles and billing exemptions never grant this permission.
 * Recheck in the worker, including scheduled jobs, without a permission cache.
 */
export async function canUsePlatformKeys(db: Db, workspaceId: string): Promise<boolean> {
  const ownerEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!ownerEmail) return false;

  const members = await db
    .select({ email: users.email, status: users.status, workspaceStatus: workspaces.status })
    .from(users)
    .innerJoin(workspaces, eq(workspaces.id, users.workspaceId))
    .where(and(eq(users.workspaceId, workspaceId), isNull(users.deletedAt)))
    .limit(2);

  // There is currently one account per workspace. If sharing is introduced,
  // refuse global keys until jobs can be authorized against an individual actor.
  const owner = members[0];
  return members.length === 1 && owner?.email.trim().toLowerCase() === ownerEmail &&
    owner.status === 'active' && owner.workspaceStatus === 'active';
}
