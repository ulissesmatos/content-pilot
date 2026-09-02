import { desc } from 'drizzle-orm';
import { getLocale, getTranslations } from 'next-intl/server';
import { ScrollText } from 'lucide-react';
import { auditLogs, getDb } from '@content-pilot/db';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { DataList } from '@/components/admin/data-list';
import { Pager } from '@/components/admin/pager';
import { Badge } from '@/components/ui/badge';
import { requireAdmin } from '@/lib/auth';

export const metadata = { title: 'Auditoria' };

const PER_PAGE = 25;

type AuditRow = typeof auditLogs.$inferSelect;

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireAdmin();
  const [params, t, locale] = await Promise.all([
    searchParams,
    getTranslations('admin'),
    getLocale(),
  ]);
  const page = Math.max(1, Number(params.page ?? '1') || 1);
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' });

  // Busca uma linha a mais para saber se existe próxima página sem um count().
  const rows = await getDb()
    .select()
    .from(auditLogs)
    .orderBy(desc(auditLogs.createdAt))
    .limit(PER_PAGE + 1)
    .offset((page - 1) * PER_PAGE);

  const hasNext = rows.length > PER_PAGE;
  const visible = rows.slice(0, PER_PAGE);

  return (
    <>
      <PageHeader title={t('auditTitle')} description={t('auditDescription')} />

      {visible.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={t('recentEmptyTitle')}
          description={t('recentEmptyDescription')}
        />
      ) : (
        <>
          <DataList<AuditRow>
            rows={visible}
            getKey={(r) => r.id}
            columns={[
              {
                key: 'action',
                header: t('colAction'),
                priority: 'primary',
                cell: (r) => <code className="bg-muted rounded px-1.5 py-0.5 text-xs">{r.action}</code>,
              },
              {
                key: 'actor',
                header: t('colActor'),
                cell: (r) => (
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="min-w-0 break-all">{r.actorEmail}</span>
                    {r.actorRole === 'super_admin' ? (
                      <Badge variant="secondary" className="shrink-0">
                        {t('roleSuperAdmin')}
                      </Badge>
                    ) : null}
                  </div>
                ),
              },
              {
                key: 'target',
                header: t('colTarget'),
                cell: (r) => (
                  <span className="text-muted-foreground text-sm">
                    {r.targetType}
                    {r.targetId ? ` · ${r.targetId.slice(0, 8)}` : ''}
                  </span>
                ),
              },
              {
                key: 'diff',
                header: t('colDiff'),
                fullWidth: true,
                cell: (r) =>
                  r.diff ? (
                    <details className="min-w-0">
                      <summary className="text-muted-foreground cursor-pointer text-xs select-none">
                        {t('showDiff')}
                      </summary>
                      <pre className="bg-muted mt-1 max-h-64 overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
                        {JSON.stringify(r.diff, null, 2)}
                      </pre>
                    </details>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  ),
              },
              {
                key: 'ip',
                header: t('colIp'),
                priority: 'meta',
                cell: (r) => r.ip ?? '—',
              },
              {
                key: 'createdAt',
                header: t('colWhen'),
                priority: 'meta',
                cell: (r) => dateFmt.format(r.createdAt),
              },
            ]}
          />
          <Pager page={page} hasNext={hasNext} basePath="/admin/audit" />
        </>
      )}
    </>
  );
}
