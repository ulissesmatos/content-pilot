import { and, desc, eq, ilike, isNull, type SQL } from 'drizzle-orm';
import { getLocale, getTranslations } from 'next-intl/server';
import { Search, Users } from 'lucide-react';
import { getDb, users, workspaces } from '@content-pilot/db';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { DataList } from '@/components/admin/data-list';
import { Pager } from '@/components/admin/pager';
import { UserStatusActions } from '@/components/admin/user-status-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { requireAdmin } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/super-admin';
import { dateTimeFormat } from '@/lib/datetime';

export const metadata = { title: 'Usuários' };

const PER_PAGE = 25;

const STATUS_TONE = {
  active: 'secondary',
  suspended: 'outline',
  banned: 'destructive',
} as const;

/** `%` e `_` são curingas do LIKE — escapamos para a busca ser literal. */
function likeLiteral(term: string) {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; status?: string }>;
}) {
  const session = await requireAdmin();
  const [params, t, locale] = await Promise.all([
    searchParams,
    getTranslations('admin'),
    getLocale(),
  ]);

  const page = Math.max(1, Number(params.page ?? '1') || 1);
  const q = (params.q ?? '').trim().slice(0, 200);
  const status = ['active', 'suspended', 'banned'].includes(params.status ?? '')
    ? (params.status as 'active' | 'suspended' | 'banned')
    : undefined;
  const dateFmt = dateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });

  const filters: SQL[] = [isNull(users.deletedAt)];
  if (q) filters.push(ilike(users.email, likeLiteral(q)));
  if (status) filters.push(eq(users.status, status));

  const rows = await getDb()
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      status: users.status,
      statusReason: users.statusReason,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      workspaceId: users.workspaceId,
      workspaceName: workspaces.name,
      billingBypass: workspaces.billingBypass,
    })
    .from(users)
    .innerJoin(workspaces, eq(workspaces.id, users.workspaceId))
    .where(and(...filters))
    .orderBy(desc(users.createdAt))
    .limit(PER_PAGE + 1)
    .offset((page - 1) * PER_PAGE);

  const hasNext = rows.length > PER_PAGE;
  const visible = rows.slice(0, PER_PAGE);
  type Row = (typeof visible)[number];

  return (
    <>
      <PageHeader title={t('usersTitle')} description={t('usersDescription')} />

      {/* GET puro: filtro sem JS, estado na URL */}
      <form method="get" className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            name="q"
            defaultValue={q}
            placeholder={t('usersSearchPlaceholder')}
            className="pl-8"
            aria-label={t('usersSearchPlaceholder')}
          />
        </div>
        <select
          name="status"
          defaultValue={status ?? ''}
          aria-label={t('colStatus')}
          className="border-input bg-background h-9 rounded-md border px-3 text-sm shadow-xs"
        >
          <option value="">{t('statusAny')}</option>
          <option value="active">{t('statusActive')}</option>
          <option value="suspended">{t('statusSuspended')}</option>
          <option value="banned">{t('statusBanned')}</option>
        </select>
        <Button type="submit" variant="outline" size="sm">
          {t('filter')}
        </Button>
      </form>

      {visible.length === 0 ? (
        <EmptyState icon={Users} title={t('usersEmptyTitle')} description={t('usersEmptyDescription')} />
      ) : (
        <>
          <DataList<Row>
            rows={visible}
            getKey={(r) => r.id}
            columns={[
              {
                key: 'email',
                header: t('colUser'),
                priority: 'primary',
                cell: (r) => (
                  <div className="min-w-0">
                    <div className="min-w-0 break-all">{r.email}</div>
                    {r.name ? (
                      <div className="text-muted-foreground truncate text-xs">{r.name}</div>
                    ) : null}
                  </div>
                ),
              },
              {
                key: 'workspace',
                header: t('colWorkspace'),
                cell: (r) => (
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="min-w-0 break-words">{r.workspaceName}</span>
                    {r.billingBypass ? (
                      <Badge variant="outline" className="shrink-0">
                        {t('bypassBadge')}
                      </Badge>
                    ) : null}
                  </div>
                ),
              },
              {
                key: 'role',
                header: t('colRole'),
                cell: (r) =>
                  isSuperAdmin(r.email) ? (
                    <Badge>{t('roleSuperAdmin')}</Badge>
                  ) : r.role === 'admin' ? (
                    <Badge variant="secondary">{t('roleAdmin')}</Badge>
                  ) : (
                    <span className="text-muted-foreground text-sm">{t('roleOwner')}</span>
                  ),
              },
              {
                key: 'status',
                header: t('colStatus'),
                cell: (r) => (
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Badge variant={STATUS_TONE[r.status]} className="w-fit">
                      {t(`status${r.status[0]!.toUpperCase()}${r.status.slice(1)}`)}
                    </Badge>
                    {r.statusReason ? (
                      <span className="text-muted-foreground text-xs break-words">
                        {r.statusReason}
                      </span>
                    ) : null}
                  </div>
                ),
              },
              {
                key: 'lastLogin',
                header: t('colLastLogin'),
                priority: 'meta',
                cell: (r) => (r.lastLoginAt ? dateFmt.format(r.lastLoginAt) : t('never')),
              },
              {
                key: 'createdAt',
                header: t('colCreatedAt'),
                priority: 'meta',
                cell: (r) => dateFmt.format(r.createdAt),
              },
            ]}
            actions={(r) => {
              const isSelf = r.id === session.userId;
              const isSu = isSuperAdmin(r.email);
              return (
                <UserStatusActions
                  id={r.id}
                  email={r.email}
                  status={r.status}
                  locked={isSelf || isSu}
                  lockedReason={isSu ? t('lockedSuperAdmin') : isSelf ? t('lockedSelf') : undefined}
                />
              );
            }}
          />
          <Pager
            page={page}
            hasNext={hasNext}
            basePath="/admin/users"
            params={{ q: q || undefined, status }}
          />
        </>
      )}
    </>
  );
}
