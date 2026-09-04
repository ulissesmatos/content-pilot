'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { runAdminAction } from '@/lib/admin-action';
import { getBoss } from '@/lib/boss';
import type { ActionResult } from '@/lib/action-utils';

const emptySchema = z.object({}).passthrough();

/**
 * Dispara a sincronização do catálogo.
 *
 * Enfileira em vez de executar aqui: a sincronização vive no worker (ela lê a
 * chave de plataforma e fala com três APIs externas), e o painel não deve
 * segurar uma request enquanto isso acontece. O agendamento diário usa o mesmo
 * handler.
 */
export async function syncCatalogAction(input: unknown): Promise<ActionResult<null>> {
  return runAdminAction(
    emptySchema,
    input ?? {},
    { action: 'catalog.sync', targetType: 'model_profile', superAdminOnly: true },
    async (_data, { audit }) => {
      const boss = await getBoss();
      await boss.send('catalog.sync', {});
      audit({ diff: { enqueued: true } });
      revalidatePath('/admin/ai/catalog');
      return null;
    },
  );
}
