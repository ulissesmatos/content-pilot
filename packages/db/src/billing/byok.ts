import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../client';
import { credentials } from '../schema';

/** Provedores de IA: chave própria de qualquer um deles caracteriza BYOK. */
const LLM_TYPES = ['anthropic', 'openai', 'openrouter'] as const;

/**
 * O workspace paga a própria IA?
 *
 * As cotas de CONSUMO (posts/mês, tokens/mês) existem para medir o que a
 * plataforma financia. Quem traz a própria chave paga o provedor direto, então
 * limitar o volume dele não protege caixa nenhum — só atrapalha.
 *
 * Os limites ESTRUTURAIS (sites, autopilots) não passam por aqui de propósito:
 * eles medem o que roda no nosso worker, não o que sai do bolso do usuário. Um
 * autopilot ativo executa sozinho pelo scheduler, sem ninguém pedir.
 */
export async function usesOwnLlmKey(db: Db, workspaceId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(and(eq(credentials.workspaceId, workspaceId), inArray(credentials.type, LLM_TYPES)))
    .limit(1);
  return Boolean(row);
}
