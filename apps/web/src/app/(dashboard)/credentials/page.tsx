import { desc, eq } from 'drizzle-orm';
import { KeyRound } from 'lucide-react';
import { credentials, getTenantDb, getWorkspaceAiSettings } from '@content-pilot/db';
import { AiSettingsCard } from '@/components/credentials/ai-settings-card';
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
  const { workspaceId, isSuperAdmin } = await requireSession();
  const [t, locale] = await Promise.all([getTranslations('credentials'), getLocale()]);
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });
  // Só as credenciais do próprio workspace: as chaves da plataforma são
  // gerenciadas em /admin/ai/keys e não aparecem no painel do cliente.
  const db = getTenantDb(workspaceId);
  const [rows, aiSettings] = await Promise.all([
    db
      .select({
        id: credentials.id,
        type: credentials.type,
        name: credentials.name,
        maskedHint: credentials.maskedHint,
        lastUsedAt: credentials.lastUsedAt,
        createdAt: credentials.createdAt,
      })
      .from(credentials)
      .where(eq(credentials.workspaceId, workspaceId))
      .orderBy(desc(credentials.createdAt)),
    getWorkspaceAiSettings(db, workspaceId),
  ]);
  const llmProviders = (['anthropic', 'openai', 'openrouter'] as const).filter((p) =>
    rows.some((r) => r.type === p),
  );

  return (
    <>
      <PageHeader title={t('title')} description={t('description')}>
        <CreateCredentialDialog />
      </PageHeader>
      {!isSuperAdmin ? <p className="text-muted-foreground mb-6 text-sm">{t('ownKeysNotice')}</p> : null}
      <AiSettingsCard
        availableProviders={llmProviders}
        initialProvider={aiSettings?.provider ?? null}
        initialModel={aiSettings?.model ?? null}
        initialPreferOwnKeys={aiSettings?.preferOwnKeys ?? true}
        initialImageGenModel={aiSettings?.imageGenModel ?? null}
        isSuperAdmin={isSuperAdmin}
      />
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
