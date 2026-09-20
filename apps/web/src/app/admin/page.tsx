import { desc, sql } from 'drizzle-orm';
import { getTranslations, getLocale } from 'next-intl/server';
import { Building2, ScrollText, ShieldCheck, Users } from 'lucide-react';
import { auditLogs, getDb, users, workspaces } from '@content-pilot/db';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireAdmin } from '@/lib/auth';

export const metadata = { title: 'Admin' };

export default async function AdminOverviewPage() {
  const session = await requireAdmin();
  const db = getDb();
  const [t, locale] = await Promise.all([getTranslations('admin'), getLocale()]);
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });

  const [userStats, wsStats, recent] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*) filter (where deleted_at is null)`,
        suspended: sql<number>`count(*) filter (where deleted_at is null and status = 'suspended')`,
        banned: sql<number>`count(*) filter (where deleted_at is null and status = 'banned')`,
        deleted: sql<number>`count(*) filter (where deleted_at is not null)`,
        admins: sql<number>`count(*) filter (where deleted_at is null and role = 'admin')`,
      })
      .from(users),
    db
      .select({
        total: sql<number>`count(*)`,
        suspended: sql<number>`count(*) filter (where status = 'suspended')`,
        bypass: sql<number>`count(*) filter (where billing_bypass)`,
      })
      .from(workspaces),
    db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(8),
  ]);

  const u = userStats[0];
  const w = wsStats[0];
  const blocked = Number(u?.suspended ?? 0) + Number(u?.banned ?? 0);

  return (
    <>
      <PageHeader title={t('title')} description={t('description')}>
        <Badge variant={session.isSuperAdmin ? 'default' : 'secondary'}>
          {session.isSuperAdmin ? t('roleSuperAdmin') : t('roleAdmin')}
        </Badge>
      </PageHeader>

      <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
        <StatCard
          title={t('statUsers')}
          value={String(u?.total ?? 0)}
          hint={t('statUsersHint', { admins: Number(u?.admins ?? 0) })}
          icon={Users}
        />
        <StatCard
          title={t('statBlocked')}
          value={String(blocked)}
          hint={t('statBlockedHint', { deleted: Number(u?.deleted ?? 0) })}
          icon={ShieldCheck}
        />
        <StatCard
          title={t('statWorkspaces')}
          value={String(w?.total ?? 0)}
          hint={t('statWorkspacesHint', { suspended: Number(w?.suspended ?? 0) })}
          icon={Building2}
        />
        <StatCard
          title={t('statBypass')}
          value={String(w?.bypass ?? 0)}
          hint={t('statBypassHint')}
          icon={ScrollText}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('recentTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title={t('recentEmptyTitle')}
              description={t('recentEmptyDescription')}
            />
          ) : (
            <ul className="divide-y">
              {recent.map((row) => (
                <li key={row.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2 text-sm">
                  <code className="bg-muted rounded px-1.5 py-0.5 text-xs">{row.action}</code>
                  <span className="text-muted-foreground min-w-0 break-all">{row.actorEmail}</span>
                  <span className="text-muted-foreground ml-auto text-xs whitespace-nowrap">
                    {dateFmt.format(row.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
