import { z } from 'zod';
import { getRunProgress } from '@/lib/run-progress';
import { requireSession } from '@/lib/auth';

/**
 * Progresso de uma execução, para a tela de acompanhamento ao vivo.
 *
 * O middleware do projeto NÃO cobre /api (o matcher o exclui de propósito, por
 * causa do webhook do Stripe e do health check), então a autenticação é feita
 * aqui. O workspace vem da sessão verificada, nunca da URL: pedir o id de um run
 * de outro cliente devolve 404, igual a um id que não existe.
 */
export const dynamic = 'force-dynamic';

const idSchema = z.string().uuid();

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let workspaceId: string;
  try {
    ({ workspaceId } = await requireSession());
  } catch {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }

  const parsed = idSchema.safeParse((await params).id);
  if (!parsed.success) return Response.json({ error: 'not_found' }, { status: 404 });

  const progress = await getRunProgress(workspaceId, parsed.data);
  if (!progress) return Response.json({ error: 'not_found' }, { status: 404 });

  return Response.json(progress, { headers: { 'Cache-Control': 'no-store' } });
}
