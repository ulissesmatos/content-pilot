import { desc, eq } from 'drizzle-orm';
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
import { requireSession } from '@/lib/auth';

export const metadata = { title: 'Credenciais' };

const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export default async function CredentialsPage() {
  const { workspaceId } = await requireSession();
  const rows = await getDb()
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
    .orderBy(desc(credentials.createdAt));

  return (
    <>
      <PageHeader
        title="Credenciais"
        description="Chaves e senhas criptografadas com AES-256-GCM — o segredo nunca volta ao navegador."
      >
        <CreateCredentialDialog />
      </PageHeader>
      {rows.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="Nenhuma credencial salva"
          description="Comece salvando o application password do seu WordPress e as chaves dos provedores de IA."
        />
      ) : (
        <Card className="py-0">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Segredo</TableHead>
                  <TableHead>Último uso</TableHead>
                  <TableHead>Criada em</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{credentialTypeLabel(row.type)}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {row.maskedHint ?? '••••'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {row.lastUsedAt ? dateFmt.format(row.lastUsedAt) : 'nunca'}
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
