import 'server-only';
import { and, desc, eq, inArray, isNotNull, runLogs, runs, briefs, discoveredTopics, getTenantDb } from '@content-pilot/db';
import { deriveStages, stageProgress, type RunKind, type RunStatus, type StageState } from '@content-pilot/core';

/**
 * Estado de uma execução para a tela de acompanhamento ao vivo.
 *
 * O problema que isto resolve: clicar em "Descobrir agora" abria o run da
 * DESCOBERTA, que termina em segundos, mas quem gera o post são runs FILHOS
 * (kind `create`) que a descoberta enfileira. A tela parava de acompanhar no
 * meio e o post continuava sendo gerado onde ninguém via. Aqui a descoberta é
 * seguida até o último post que ela gerou.
 */

export interface ProgressLog {
  ts: string;
  line: string;
}

export interface ProgressPost {
  runId: string;
  briefId: string;
  topic: string;
  runStatus: RunStatus;
  stages: StageState[];
  progress: number;
  /** Estado da pauta: generating, ready_for_review, published, failed... */
  briefStatus: string;
  /** Link do post no WordPress, quando já existe. */
  wpUrl: string | null;
  error: string | null;
  logs: ProgressLog[];
}

export interface RunProgress {
  run: {
    id: string;
    kind: RunKind;
    status: RunStatus;
    startedAt: string;
    finishedAt: string | null;
    error: string | null;
  };
  logs: ProgressLog[];
  stages: StageState[];
  progress: number;
  /** Posts gerados por esta execução: ela mesma (`create`) ou os filhos (`discover`). */
  posts: ProgressPost[];
  /** Pautas criadas pela descoberta que ficaram para revisão manual (sem geração automática). */
  pendingBriefs: Array<{ briefId: string; topic: string }>;
  /** A execução E todos os runs filhos terminaram. */
  done: boolean;
}

const LOG_LIMIT = 300;

const asIso = (d: Date | null) => (d ? d.toISOString() : null);

export async function getRunProgress(workspaceId: string, runId: string): Promise<RunProgress | null> {
  const db = getTenantDb(workspaceId);

  const [run] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.workspaceId, workspaceId)))
    .limit(1);
  if (!run) return null;

  const kind = run.kind as RunKind;
  const logs = await loadLogs(db, runId);

  // Quem gera post: o próprio run (create) ou os runs filhos da descoberta.
  let postRuns: Array<{ id: string; briefId: string | null; status: string; error: string | null }> = [];
  let pendingBriefs: RunProgress['pendingBriefs'] = [];

  if (kind === 'create') {
    postRuns = [{ id: run.id, briefId: run.briefId, status: run.status, error: run.error }];
  } else if (kind === 'discover') {
    const topics = await db
      .select({ briefId: discoveredTopics.briefId, topic: discoveredTopics.topic })
      .from(discoveredTopics)
      .where(and(eq(discoveredTopics.runId, runId), isNotNull(discoveredTopics.briefId)));
    const briefIds = topics.map((t) => t.briefId!).filter(Boolean);

    if (briefIds.length > 0) {
      // O run de geração MAIS RECENTE de cada pauta criada por esta descoberta.
      const children = await db
        .select({ id: runs.id, briefId: runs.briefId, status: runs.status, error: runs.error, startedAt: runs.startedAt })
        .from(runs)
        .where(and(inArray(runs.briefId, briefIds), eq(runs.kind, 'create')))
        .orderBy(desc(runs.startedAt));
      const latest = new Map<string, (typeof children)[number]>();
      for (const c of children) if (c.briefId && !latest.has(c.briefId)) latest.set(c.briefId, c);
      postRuns = [...latest.values()];

      // Pauta criada mas sem geração enfileirada (autoQueue desligado): fica para revisão.
      const generating = new Set(postRuns.map((r) => r.briefId));
      pendingBriefs = topics
        .filter((t) => t.briefId && !generating.has(t.briefId))
        .map((t) => ({ briefId: t.briefId!, topic: t.topic }));
    }
  }

  const posts = await Promise.all(
    postRuns.filter((r) => r.briefId).map((r) => loadPost(db, r as { id: string; briefId: string; status: string; error: string | null })),
  );

  const stages = deriveStages(
    logs.map((l) => l.line),
    run.status as RunStatus,
    kind,
  );
  const runFinished = run.status !== 'running';
  const childrenFinished = posts.every((p) => p.runStatus !== 'running');

  return {
    run: {
      id: run.id,
      kind,
      status: run.status as RunStatus,
      startedAt: run.startedAt.toISOString(),
      finishedAt: asIso(run.finishedAt),
      error: run.error,
    },
    logs,
    stages,
    progress: stageProgress(stages),
    posts,
    pendingBriefs,
    done: runFinished && childrenFinished,
  };
}

async function loadLogs(db: ReturnType<typeof getTenantDb>, runId: string): Promise<ProgressLog[]> {
  // As últimas N, devolvidas em ordem cronológica.
  const rows = await db
    .select({ ts: runLogs.ts, line: runLogs.line })
    .from(runLogs)
    .where(eq(runLogs.runId, runId))
    .orderBy(desc(runLogs.ts), desc(runLogs.id))
    .limit(LOG_LIMIT);
  return rows.reverse().map((r) => ({ ts: r.ts.toISOString(), line: r.line }));
}

async function loadPost(
  db: ReturnType<typeof getTenantDb>,
  r: { id: string; briefId: string; status: string; error: string | null },
): Promise<ProgressPost> {
  const [brief] = await db
    .select({
      topic: briefs.topic,
      status: briefs.status,
      url: briefs.createdWpPostUrl,
      error: briefs.error,
    })
    .from(briefs)
    .where(eq(briefs.id, r.briefId))
    .limit(1);
  const logs = await loadLogs(db, r.id);
  const status = r.status as RunStatus;
  const stages = deriveStages(
    logs.map((l) => l.line),
    status,
    'create',
  );
  return {
    runId: r.id,
    briefId: r.briefId,
    topic: brief?.topic ?? '',
    runStatus: status,
    stages,
    progress: stageProgress(stages),
    briefStatus: brief?.status ?? 'pending',
    wpUrl: brief?.url ?? null,
    error: brief?.error ?? r.error,
    logs,
  };
}

