import Link from 'next/link';
import { and, desc, eq, gte, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { CircleDollarSign, ClipboardCheck, FileText, Sparkles } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  autopilotConfigs,
  briefs,
  contentTemplates,
  credentials,
  discoveredTopics,
  getTenantDb,
  llmCalls,
  runs,
  sites,
} from '@content-pilot/db';
import {
  autopilotDiscoverySchema,
  autopilotLimitsSchema,
  type ContentType,
} from '@content-pilot/core';
import {
  AutopilotEnabledSwitch,
  DeleteAutopilotButton,
  RunDiscoveryButton,
} from '@/components/autopilot/autopilot-row-actions';
import { TopicRowActions } from '@/components/autopilot/topic-row-actions';
import { AutoRefresh } from '@/components/auto-refresh';
import { CreateAutopilotDialog, EditAutopilotDialog } from '@/components/autopilot/create-autopilot-dialog';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireSession } from '@/lib/auth';
import { getWorkspaceReadiness } from '@/lib/readiness';
import { ReadinessAlert } from '@/components/readiness-alert';

export const metadata = { title: 'Autopilot' };

/** Extrai os valores editáveis de um config para pré-preencher o form de edição. */
function toInitial(config: typeof autopilotConfigs.$inferSelect) {
  const discovery = autopilotDiscoverySchema.parse(config.discovery);
  const limits = autopilotLimitsSchema.parse(config.limits ?? {});
  return {
    id: config.id,
    name: config.name,
    siteId: config.siteId,
    templateId: config.templateId,
    seedTopics: config.seedTopics.join('\n'),
    language: config.language,
    scheduleCron: config.scheduleCron,
    autoQueue: config.autoQueue,
    publishMode: config.publishMode as 'draft' | 'publish',
    postsPerCycle: discovery.postsPerCycle,
    allowedTypes: discovery.allowedTypes,
    monthlyBudgetUsd: limits.monthlyBudgetUsd,
    maxPostsPerDay: limits.maxPostsPerDay,
  };
}

export default async function AutopilotPage() {
  const { workspaceId, email } = await requireSession();
  // Decidido no servidor: o botão desabilitado é conforto, o bloqueio real
  // está na action (assertWorkspaceReady).
  const readiness = await getWorkspaceReadiness(workspaceId, email);
  const db = getTenantDb(workspaceId);
  const [t, locale] = await Promise.all([getTranslations('autopilot'), getLocale()]);

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [configs, siteRows, templateRows, wpCredentialRows, feed, monthCosts, monthStats] = await Promise.all([
    db
      .select({ config: autopilotConfigs, siteName: sites.name, templateName: contentTemplates.name })
      .from(autopilotConfigs)
      .innerJoin(sites, eq(autopilotConfigs.siteId, sites.id))
      .innerJoin(contentTemplates, eq(autopilotConfigs.templateId, contentTemplates.id))
      .where(eq(autopilotConfigs.workspaceId, workspaceId))
      .orderBy(desc(autopilotConfigs.createdAt)),
    db.select({ id: sites.id, name: sites.name }).from(sites).where(eq(sites.workspaceId, workspaceId)),
    db
      .select({ id: contentTemplates.id, name: contentTemplates.name })
      .from(contentTemplates)
      .where(or(isNull(contentTemplates.workspaceId), eq(contentTemplates.workspaceId, workspaceId))),
    db
      .select({ id: credentials.id, name: credentials.name })
      .from(credentials)
      .where(and(eq(credentials.workspaceId, workspaceId), eq(credentials.type, 'wordpress'))),
    db
      .select({ topic: discoveredTopics, briefStatus: briefs.status })
      .from(discoveredTopics)
      .leftJoin(briefs, eq(discoveredTopics.briefId, briefs.id))
      .where(eq(discoveredTopics.workspaceId, workspaceId))
      .orderBy(desc(discoveredTopics.createdAt))
      .limit(40),
    // custo LLM do mês por config (descoberta + gerações atribuídas)
    db
      .select({
        configId: runs.autopilotConfigId,
        cost: sql<string>`coalesce(sum(${llmCalls.costEstimateUsd}), 0)`,
      })
      .from(llmCalls)
      .innerJoin(runs, eq(llmCalls.runId, runs.id))
      .where(
        and(
          eq(runs.workspaceId, workspaceId),
          isNotNull(runs.autopilotConfigId),
          gte(llmCalls.createdAt, monthStart),
        ),
      )
      .groupBy(runs.autopilotConfigId),
    // pautas do autopilot no mês: aguardando revisão + geradas
    db
      .select({
        pendingReview: sql<number>`count(*) filter (where ${discoveredTopics.status} = 'pending')`,
        createdBriefs: sql<number>`count(*) filter (where ${discoveredTopics.briefId} is not null and ${discoveredTopics.createdAt} >= ${monthStart})`,
      })
      .from(discoveredTopics)
      .where(eq(discoveredTopics.workspaceId, workspaceId)),
  ]);

  // descoberta/geração do autopilot em andamento → página se atualiza sozinha
  const [runningRun] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(eq(runs.workspaceId, workspaceId), eq(runs.status, 'running'), isNotNull(runs.autopilotConfigId)),
    )
    .limit(1);

  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });
  const money = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' });
  const costByConfig = new Map(monthCosts.map((c) => [c.configId, Number(c.cost)]));
  const totalMonthCost = monthCosts.reduce((acc, c) => acc + Number(c.cost), 0);
  const pendingReview = Number(monthStats[0]?.pendingReview ?? 0);
  const createdBriefs = Number(monthStats[0]?.createdBriefs ?? 0);

  const typeLabel = (ct: string) => t(`contentTypes.${ct as ContentType}` as never) || ct;
  const publishLabel = (mode: string) => (mode === 'publish' ? t('publishModePublish') : t('publishModeDraft'));

  return (
    <>
      <AutoRefresh enabled={!!runningRun} />
      <PageHeader title={t('title')} description={t('description')}>
        <CreateAutopilotDialog sites={siteRows} templates={templateRows} wordpressCredentials={wpCredentialRows} />
      </PageHeader>
      <ReadinessAlert issues={readiness.issues} />

      {configs.length > 0 ? (
        <div className="mb-6 grid grid-cols-3 gap-2 sm:gap-4">
          <StatCard title={t('statPendingReview')} value={String(pendingReview)} icon={ClipboardCheck} />
          <StatCard title={t('statBriefsMonth')} value={String(createdBriefs)} icon={FileText} />
          <StatCard title={t('statCostMonth')} value={money.format(totalMonthCost)} icon={CircleDollarSign} />
        </div>
      ) : null}

      {configs.length === 0 ? (
        <EmptyState icon={Sparkles} title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <>
          {/* Mobile: lista de cards — a tabela de 7 colunas não cabe na tela e obriga scroll lateral pra alcançar as ações. */}
          <div className="grid gap-3 md:hidden">
            {configs.map(({ config, siteName }) => {
              const limits = autopilotLimitsSchema.parse(config.limits ?? {});
              const cost = costByConfig.get(config.id) ?? 0;
              const pct = Math.min(100, Math.round((cost / limits.monthlyBudgetUsd) * 100));
              return (
                <Card key={config.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{config.name}</div>
                      <p className="text-muted-foreground mt-0.5 truncate text-xs">{config.seedTopics.join(', ')}</p>
                    </div>
                    <AutopilotEnabledSwitch id={config.id} enabled={config.enabled} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <Badge variant="secondary" className="border-transparent">
                      {config.autoQueue
                        ? t('modeAuto', { publishMode: publishLabel(config.publishMode) })
                        : t('modeReview')}
                    </Badge>
                    <span className="text-muted-foreground">{siteName}</span>
                  </div>
                  <div className="mt-3">
                    <div className="flex items-baseline justify-between text-sm">
                      <span>{money.format(cost)}</span>
                      <span className="text-muted-foreground text-xs">
                        {t('budgetOf', { budget: money.format(limits.monthlyBudgetUsd) })}
                      </span>
                    </div>
                    <div className="bg-muted mt-1 h-1.5 w-full overflow-hidden rounded-full">
                      <div
                        className={`h-full rounded-full ${pct >= 100 ? 'bg-destructive' : pct >= 80 ? 'bg-amber-500' : 'bg-primary'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <p className="text-muted-foreground mt-2 text-xs">
                    {t('colNextRun')}: {config.enabled && config.nextRunAt ? dateFmt.format(config.nextRunAt) : '—'}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <RunDiscoveryButton id={config.id} blocked={!readiness.ok} />
                    <EditAutopilotDialog
                      sites={siteRows}
                      templates={templateRows}
                      wordpressCredentials={wpCredentialRows}
                      initial={toInitial(config)}
                    />
                    <DeleteAutopilotButton id={config.id} name={config.name} />
                  </div>
                </Card>
              );
            })}
          </div>

          <Card className="hidden py-0 md:block">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colName')}</TableHead>
                  <TableHead>{t('colSite')}</TableHead>
                  <TableHead>{t('colMode')}</TableHead>
                  <TableHead>{t('colMonthCost')}</TableHead>
                  <TableHead>{t('colNextRun')}</TableHead>
                  <TableHead>{t('colEnabled')}</TableHead>
                  <TableHead className="w-64" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {configs.map(({ config, siteName }) => {
                  const limits = autopilotLimitsSchema.parse(config.limits ?? {});
                  const cost = costByConfig.get(config.id) ?? 0;
                  const pct = Math.min(100, Math.round((cost / limits.monthlyBudgetUsd) * 100));
                  return (
                    <TableRow key={config.id}>
                      <TableCell className="font-medium">
                        <div>{config.name}</div>
                        <p className="text-muted-foreground mt-0.5 max-w-48 truncate text-xs">
                          {config.seedTopics.join(', ')}
                        </p>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{siteName}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="border-transparent">
                          {config.autoQueue
                            ? t('modeAuto', { publishMode: publishLabel(config.publishMode) })
                            : t('modeReview')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {money.format(cost)}{' '}
                          <span className="text-muted-foreground text-xs">
                            {t('budgetOf', { budget: money.format(limits.monthlyBudgetUsd) })}
                          </span>
                        </div>
                        <div className="bg-muted mt-1 h-1.5 w-24 overflow-hidden rounded-full">
                          <div
                            className={`h-full rounded-full ${pct >= 100 ? 'bg-destructive' : pct >= 80 ? 'bg-amber-500' : 'bg-primary'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {config.enabled && config.nextRunAt ? dateFmt.format(config.nextRunAt) : '—'}
                      </TableCell>
                      <TableCell>
                        <AutopilotEnabledSwitch id={config.id} enabled={config.enabled} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <RunDiscoveryButton id={config.id} blocked={!readiness.ok} />
                          <EditAutopilotDialog
                            sites={siteRows}
                            templates={templateRows}
                            wordpressCredentials={wpCredentialRows}
                            initial={toInitial(config)}
                          />
                          <DeleteAutopilotButton id={config.id} name={config.name} />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        </>
      )}

      {feed.length > 0 ? (
        <>
          {/* Mobile: mesmo motivo do bloco acima — 5 colunas não cabem na tela. */}
          <div className="mt-6 grid gap-3 md:hidden">
            <h2 className="text-base font-semibold">{t('discoveredTitle')}</h2>
            {feed.map(({ topic, briefStatus }) => (
              <Card key={topic.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{topic.suggestedTitle || topic.topic}</div>
                    {topic.discardReason ? (
                      <p className="text-muted-foreground mt-0.5 text-xs">{topic.discardReason}</p>
                    ) : topic.briefId ? (
                      <Link href="/briefs" className="text-muted-foreground mt-0.5 text-xs hover:underline">
                        {t('becameBrief')}
                        {briefStatus ? ` · ${briefStatus}` : ''}
                      </Link>
                    ) : null}
                  </div>
                  <StatusBadge status={topic.status} />
                </div>
                <div className="text-muted-foreground mt-2 flex items-center justify-between text-xs">
                  <span>{typeLabel(topic.contentType)}</span>
                  <span>{dateFmt.format(topic.createdAt)}</span>
                </div>
                {topic.status === 'pending' ? (
                  <div className="mt-3">
                    <TopicRowActions topicId={topic.id} topic={topic.suggestedTitle || topic.topic} />
                  </div>
                ) : null}
              </Card>
            ))}
          </div>

          <Card className="mt-6 hidden py-0 md:block">
          <CardHeader className="px-6 pt-5 pb-0">
            <CardTitle className="text-base">{t('discoveredTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colTopic')}</TableHead>
                  <TableHead>{t('colType')}</TableHead>
                  <TableHead>{t('colStatus')}</TableHead>
                  <TableHead>{t('colWhen')}</TableHead>
                  <TableHead className="w-44" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {feed.map(({ topic, briefStatus }) => (
                  <TableRow key={topic.id}>
                    <TableCell className="max-w-md">
                      <div className="font-medium">{topic.suggestedTitle || topic.topic}</div>
                      {topic.discardReason ? (
                        <p className="text-muted-foreground mt-0.5 truncate text-xs">{topic.discardReason}</p>
                      ) : topic.briefId ? (
                        <Link href="/briefs" className="text-muted-foreground mt-0.5 text-xs hover:underline">
                          {t('becameBrief')}
                          {briefStatus ? ` · ${briefStatus}` : ''}
                        </Link>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{typeLabel(topic.contentType)}</TableCell>
                    <TableCell>
                      <StatusBadge status={topic.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{dateFmt.format(topic.createdAt)}</TableCell>
                    <TableCell>
                      {topic.status === 'pending' ? (
                        <TopicRowActions topicId={topic.id} topic={topic.suggestedTitle || topic.topic} />
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        </>
      ) : null}
    </>
  );
}
