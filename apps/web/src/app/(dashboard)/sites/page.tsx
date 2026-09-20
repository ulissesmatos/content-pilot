import { and, desc, eq } from 'drizzle-orm';
import { Globe } from 'lucide-react';
import { credentials, getTenantDb, sites } from '@content-pilot/db';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { CreateSiteDialog } from '@/components/sites/create-site-dialog';
import { DeleteSiteButton, TestConnectionButton } from '@/components/sites/site-row-actions';
import { StatusBadge } from '@/components/status-badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getLocale, getTranslations } from 'next-intl/server';
import { requireSession } from '@/lib/auth';
import { dateTimeFormat } from '@/lib/datetime';

export const metadata = { title: 'Sites' };

export default async function SitesPage() {
  const { workspaceId } = await requireSession();
  const db = getTenantDb(workspaceId);
  const [t, locale] = await Promise.all([getTranslations('sites'), getLocale()]);
  const dateFmt = dateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });

  const [siteRows, wpCredentials] = await Promise.all([
    db.select().from(sites).where(eq(sites.workspaceId, workspaceId)).orderBy(desc(sites.createdAt)),
    db
      .select({ id: credentials.id, name: credentials.name })
      .from(credentials)
      .where(and(eq(credentials.workspaceId, workspaceId), eq(credentials.type, 'wordpress')))
      .orderBy(desc(credentials.createdAt)),
  ]);

  return (
    <>
      <PageHeader title={t('title')} description={t('description')}>
        <CreateSiteDialog wordpressCredentials={wpCredentials} />
      </PageHeader>
      {siteRows.length === 0 ? (
        <EmptyState icon={Globe} title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <Card className="py-0">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colSite')}</TableHead>
                  <TableHead>{t('colUrl')}</TableHead>
                  <TableHead>{t('colLanguage')}</TableHead>
                  <TableHead>{t('colStatus')}</TableHead>
                  <TableHead>{t('colLastCheck')}</TableHead>
                  <TableHead className="w-52" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {siteRows.map((site) => (
                  <TableRow key={site.id}>
                    <TableCell className="font-medium">{site.name}</TableCell>
                    <TableCell className="text-muted-foreground max-w-56 truncate text-sm">
                      {site.baseUrl}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{site.defaultLanguage}</TableCell>
                    <TableCell>
                      <StatusBadge status={site.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {site.lastCheckedAt ? dateFmt.format(site.lastCheckedAt) : t('never')}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <TestConnectionButton siteId={site.id} />
                        <DeleteSiteButton id={site.id} name={site.name} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
