'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, getDb, runs, sql } from '@content-pilot/db';
import { z } from 'zod';
import { runAuthedAction, type ActionResult } from '@/lib/action-utils';
import { getBoss } from '@/lib/boss';

const idSchema = z.object({ id: z.string().uuid() });

/**
 * Para uma execução em andamento: marca o run como cancelado (o worker checa
 * o status antes de cada post) e cancela os jobs ainda pendentes na fila.
 * O post que já estiver no meio do processamento termina e é ignorado depois.
 */
export async function cancelRunAction(input: unknown): Promise<ActionResult<{ cancelledQueued: number }>> {
  return runAuthedAction(idSchema, input, async ({ id }, { workspaceId }) => {
    const db = getDb();
    const [run] = await db
      .select({ id: runs.id, status: runs.status })
      .from(runs)
      .where(and(eq(runs.id, id), eq(runs.workspaceId, workspaceId)))
      .limit(1);
    if (!run) throw new Error('Execução não encontrada.');
    if (run.status !== 'running') throw new Error('Esta execução não está em andamento.');

    await db
      .update(runs)
      .set({ status: 'cancelled', finishedAt: new Date(), error: 'cancelada pelo usuário' })
      .where(and(eq(runs.id, id), eq(runs.status, 'running')));

    // Cancela o que ainda não foi pego pelo worker (created/retry) na fila
    const pending = await db.execute(
      sql`select id::text as id, name from pgboss.job
          where state in ('created', 'retry')
            and name in ('job.run', 'post.process')
            and (data ->> 'runId') = ${id}`,
    );
    const rows = (pending.rows ?? []) as Array<{ id: string; name: string }>;
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
