import { desc, eq, isNull, or } from 'drizzle-orm';
import { KeyRound } from 'lucide-react';
import { credentials, getDb } from '@content-pilot/db';
import { CreateCredentialDialog } from '@/components/credentials/create-credential-dialog';
import { credentialTypeLabel } from '@/components/credentials/credential-type';
import { DeleteCredentialButton } from '@/components/credentials/delete-credential-button';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
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

export const metadata = { title: 'Credenciais' };

export default async function CredentialsPage() {
  const { workspaceId, role } = await requireSession();
  const isAdmin = role === 'admin';
  const [t, locale] = await Promise.all([getTranslations('credentials'), getLocale()]);
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });
  // admin também enxerga as credenciais da plataforma (workspace NULL)
  const scopeFilter = isAdmin
    ? or(eq(credentials.workspaceId, workspaceId), isNull(credentials.workspaceId))
    : eq(credentials.workspaceId, workspaceId);
  const rows = await getDb()
    .select({
      id: credentials.id,
      workspaceId: credentials.workspaceId,
      type: credentials.type,
      name: credentials.name,
      maskedHint: credentials.maskedHint,
      lastUsedAt: credentials.lastUsedAt,
      createdAt: credentials.createdAt,
    })
    .from(credentials)
    .where(scopeFilter)
    .orderBy(desc(credentials.createdAt));

  return (
    <>
      <PageHeader title={t('title')} description={t('description')}>
        <CreateCredentialDialog isAdmin={isAdmin} />
      </PageHeader>
      {rows.length === 0 ? (
        <EmptyState icon={KeyRound} title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <Card className="py-0">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colName')}</TableHead>
                  <TableHead>{t('colType')}</TableHead>
                  <TableHead>{t('colSecret')}</TableHead>
                  <TableHead>{t('colLastUsed')}</TableHead>
                  <TableHead>{t('colCreatedAt')}</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      {row.name}
                      {row.workspaceId === null ? (
                        <Badge variant="outline" className="ml-2 text-xs">
                          {t('platformBadge')}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{credentialTypeLabel(row.type)}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {row.maskedHint ?? '••••'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {row.lastUsedAt ? dateFmt.format(row.lastUsedAt) : t('never')}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {dateFmt.format(row.createdAt)}
                    </TableCell>
                    <TableCell>
                      <DeleteCredentialButton id={row.id} name={row.name} />
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
