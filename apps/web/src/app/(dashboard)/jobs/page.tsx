import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { RefreshCw } from 'lucide-react';
import { contentJobs, contentTemplates, credentials, getTenantDb, sites } from '@content-pilot/db';
import { jobLimitsSchema, postFilterSchema } from '@content-pilot/core';
import { CreateJobDialog, EditJobButton, type JobFormInitial } from '@/components/jobs/create-job-dialog';
import { DeleteJobButton, JobEnabledSwitch, RunNowButton } from '@/components/jobs/job-row-actions';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getLocale, getTranslations } from 'next-intl/server';
import { requireSession } from '@/lib/auth';
import { getWorkspaceReadiness } from '@/lib/readiness';
import { ReadinessAlert } from '@/components/readiness-alert';
import { dateTimeFormat } from '@/lib/datetime';

export const metadata = { title: 'Atualizar posts' };

export default async function JobsPage() {
  const { workspaceId, email } = await requireSession();
  // Decidido no servidor: o botão desabilitado é conforto, o bloqueio real
  // está na action (assertWorkspaceReady).
  const readiness = await getWorkspaceReadiness(workspaceId, email);
  const db = getTenantDb(workspaceId);
  const [t, locale] = await Promise.all([getTranslations('jobs'), getLocale()]);
  const dateFmt = dateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });

  const [jobs, siteRows, templateRows, wpCredentialRows] = await Promise.all([
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
    db
      .select({ id: credentials.id, name: credentials.name })
      .from(credentials)
      .where(and(eq(credentials.workspaceId, workspaceId), eq(credentials.type, 'wordpress'))),
  ]);

  const toInitial = (job: (typeof jobs)[number]['job']): JobFormInitial => {
    const filter = postFilterSchema.parse(job.postFilter ?? {});
    const limits = jobLimitsSchema.parse(job.limits ?? {});
    // tolerante a llmConfig malformado — o form abre com defaults em vez de derrubar a página
    return {
      id: job.id,
      name: job.name,
      siteId: job.siteId,
      templateId: job.templateId,
      scheduleCron: job.scheduleCron,
      language: job.language ?? '',
      tags: filter.tags.join(', '),
      categories: filter.categories.join(', '),
      maxPostsPerRun: limits.maxPostsPerRun,
      tokenBudgetPerRun: limits.tokenBudgetPerRun,
      skipIfSourcesUnchanged: limits.skipIfSourcesUnchanged,
      mode: limits.mode,
      searchDepth: limits.searchDepth,
    };
  };

  return (
    <>
      <PageHeader title={t('title')} description={t('description')}>
        <CreateJobDialog sites={siteRows} templates={templateRows} wordpressCredentials={wpCredentialRows} />
      </PageHeader>
      <ReadinessAlert issues={readiness.issues} />
      {jobs.length === 0 ? (
        <EmptyState icon={RefreshCw} title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <Card className="py-0">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colJob')}</TableHead>
                  <TableHead>{t('colSite')}</TableHead>
                  <TableHead>{t('colTemplate')}</TableHead>
                  <TableHead>{t('colCron')}</TableHead>
                  <TableHead>{t('colNextRun')}</TableHead>
                  <TableHead>{t('colEnabled')}</TableHead>
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
                        <RunNowButton id={job.id} blocked={!readiness.ok} />
                        <EditJobButton sites={siteRows} templates={templateRows} initial={toInitial(job)} />
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
