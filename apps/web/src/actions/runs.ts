'use server';

import { UserFacingError } from '@/lib/errors';
import { revalidatePath } from 'next/cache';
import { and, contentJobs, eq, getTenantDb, runItems, runs } from '@content-pilot/db';
import { z } from 'zod';
import { runAuthedAction, type ActionResult } from '@/lib/action-utils';
import { getBoss, pendingRunJobs } from '@/lib/boss';
import { getWordPressForSite } from '@/lib/wp';

const idSchema = z.object({ id: z.string().uuid() });

/** Statuses de run_item que aceitam retry manual. */
const RETRYABLE = new Set(['llm_failed', 'wp_failed', 'validation_failed', 'failed', 'budget_exceeded']);

/**
 * Para uma execução em andamento: marca o run como cancelado (o worker checa
 * o status antes de cada post) e cancela os jobs ainda pendentes na fila.
 * O post que já estiver no meio do processamento termina e é ignorado depois.
 */
export async function cancelRunAction(input: unknown): Promise<ActionResult<{ cancelledQueued: number }>> {
  return runAuthedAction(idSchema, input, async ({ id }, { workspaceId }) => {
    const db = getTenantDb(workspaceId);
    const [run] = await db
      .select({ id: runs.id, status: runs.status })
      .from(runs)
      .where(and(eq(runs.id, id), eq(runs.workspaceId, workspaceId)))
      .limit(1);
    if (!run) throw new UserFacingError('Execução não encontrada.');
    if (run.status !== 'running') throw new UserFacingError('Esta execução não está em andamento.');

    await db
      .update(runs)
      .set({ status: 'cancelled', finishedAt: new Date(), error: 'cancelada pelo usuário' })
      .where(and(eq(runs.id, id), eq(runs.status, 'running')));

    // Cancela o que ainda não foi pego pelo worker (created/retry) na fila
    const rows = await pendingRunJobs(workspaceId, id);
    if (rows.length > 0) {
      const boss = await getBoss();
      const byQueue = new Map<string, string[]>();
      for (const row of rows) {
        if (!byQueue.has(row.name)) byQueue.set(row.name, []);
        byQueue.get(row.name)!.push(row.id);
      }
      for (const [queue, ids] of byQueue) {
        await boss.cancel(queue, ids);
      }
    }

    revalidatePath('/runs');
    revalidatePath(`/runs/${id}`);
    return { cancelledQueued: rows.length };
  });
}

/**
 * Reprocessa um item falhado de um run de atualização: cria um run novo
 * (manual, 1 item) e enfileira post.process para o mesmo post do WordPress.
 */
export async function retryRunItemAction(input: unknown): Promise<ActionResult<{ runId: string }>> {
  return runAuthedAction(idSchema, input, async ({ id }, { workspaceId }) => {
    const db = getTenantDb(workspaceId);
    const [row] = await db
      .select({ item: runItems, run: runs })
      .from(runItems)
      .innerJoin(runs, eq(runItems.runId, runs.id))
      .where(and(eq(runItems.id, id), eq(runItems.workspaceId, workspaceId)))
      .limit(1);
    if (!row) throw new UserFacingError('Item não encontrado.');
    const { item, run } = row;
    if (run.kind !== 'update') throw new UserFacingError('Retry por item só existe para execuções de atualização — para pautas use "Regerar".');
    if (!RETRYABLE.has(item.status)) throw new UserFacingError('Este item não falhou — nada a tentar de novo.');
    if (!item.wpPostId) throw new UserFacingError('Item sem post do WordPress associado.');
    if (!run.jobId) throw new UserFacingError('O job desta execução foi excluído — crie um novo job para reprocessar o post.');

    const [newRun] = await db
      .insert(runs)
      .values({ workspaceId, jobId: run.jobId, kind: 'update', trigger: 'manual', expectedItems: 1, status: 'running' })
      .returning({ id: runs.id });

    const boss = await getBoss();
    const sent = await boss.send(
      'post.process',
      { jobId: run.jobId, runId: newRun!.id, wpPostId: item.wpPostId, retryRunItemId: item.id },
      { singletonKey: `${newRun!.id}:${item.wpPostId}`, retryLimit: 1, retryDelay: 120, expireInSeconds: 900 },
    );
    if (!sent) {
      await db
        .update(runs)
        .set({ status: 'cancelled', finishedAt: new Date(), error: 'reprocessamento já em andamento' })
        .where(eq(runs.id, newRun!.id));
      throw new UserFacingError('Já existe um reprocessamento deste post em andamento.');
    }

    revalidatePath('/runs');
    return { runId: newRun!.id };
  });
}

/**
 * Restaura no WordPress o conteúdo de antes da execução (backup gravado no
 * run_item). Desfaz uma atualização ruim sem sair do painel.
 */
export async function restoreRunItemAction(input: unknown): Promise<ActionResult> {
  return runAuthedAction(idSchema, input, async ({ id }, { workspaceId }) => {
    const db = getTenantDb(workspaceId);
    const [row] = await db
      .select({ item: runItems, run: runs })
      .from(runItems)
      .innerJoin(runs, eq(runItems.runId, runs.id))
      .where(and(eq(runItems.id, id), eq(runItems.workspaceId, workspaceId)))
      .limit(1);
    if (!row) throw new UserFacingError('Item não encontrado.');
    const { item, run } = row;
    if (!item.previousContentBackup) throw new UserFacingError('Este item não tem backup de conteúdo.');
    if (!item.wpPostId) throw new UserFacingError('Item sem post do WordPress associado.');
    if (!run.jobId) throw new UserFacingError('O job desta execução foi excluído — não é possível resolver o site do post.');

    const [job] = await db
      .select({ siteId: contentJobs.siteId })
      .from(contentJobs)
      .where(eq(contentJobs.id, run.jobId))
      .limit(1);
    if (!job) throw new UserFacingError('Job da execução não encontrado.');

    const wp = await getWordPressForSite(workspaceId, job.siteId);
    await wp.updatePost(item.wpPostId, { content: item.previousContentBackup });

    revalidatePath(`/runs/${run.id}`);
    return null;
  });
}
