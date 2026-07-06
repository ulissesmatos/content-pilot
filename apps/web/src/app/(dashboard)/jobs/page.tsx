import { desc, eq, isNull, or } from 'drizzle-orm';
import { RefreshCw } from 'lucide-react';
import { contentJobs, contentTemplates, getDb, sites } from '@content-pilot/db';
import { CreateJobDialog } from '@/components/jobs/create-job-dialog';
import { DeleteJobButton, JobEnabledSwitch, RunNowButton } from '@/components/jobs/job-row-actions';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireSession } from '@/lib/auth';

export const metadata = { title: 'Jobs de atualização' };

const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export default async function JobsPage() {
  const { workspaceId } = await requireSession();
  const db = getDb();

  const [jobs, siteRows, templateRows] = await Promise.all([
    db
      .select({
        job: contentJobs,
        siteName: sites.name,
        templateName: contentTemplates.name,
      })
      .from(contentJobs)
      .innerJoin(sites, eq(contentJobs.siteId, sites.id))
      .innerJoin(contentTemplates, eq(contentJobs.templateId, contentTemplates.id))
      .where(eq(contentJobs.workspaceId, workspaceId))
      .orderBy(desc(contentJobs.createdAt)),
    db.select({ id: sites.id, name: sites.name }).from(sites).where(eq(sites.workspaceId, workspaceId)),
    db
      .select({ id: contentTemplates.id, name: contentTemplates.name })
      .from(contentTemplates)
      .where(or(isNull(contentTemplates.workspaceId), eq(contentTemplates.workspaceId, workspaceId))),
  ]);

  return (
    <>
      <PageHeader
        title="Jobs de atualização"
        description="Atualização periódica de posts por categoria/tag. O worker verifica os agendamentos a cada minuto."
      >
        <CreateJobDialog sites={siteRows} templates={templateRows} />
      </PageHeader>
      {jobs.length === 0 ? (
        <EmptyState
          icon={RefreshCw}
          title="Nenhum job configurado"
          description="Crie um job apontando para um site e um template para manter seus posts atualizados automaticamente."
        />
      ) : (
        <Card className="py-0">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead>Cron</TableHead>
                  <TableHead>Próxima execução</TableHead>
                  <TableHead>Ativo</TableHead>
                  <TableHead className="w-56" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map(({ job, siteName, templateName }) => (
                  <TableRow key={job.id}>
                    <TableCell className="font-medium">{job.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{siteName}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{templateName}</TableCell>
                    <TableCell className="font-mono text-xs">{job.scheduleCron}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {job.enabled && job.nextRunAt ? dateFmt.format(job.nextRunAt) : '—'}
                    </TableCell>
                    <TableCell>
                      <JobEnabledSwitch id={job.id} enabled={job.enabled} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <RunNowButton id={job.id} />
                        <DeleteJobButton id={job.id} name={job.name} />
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
