import { randomUUID } from 'node:crypto';
import { UserFacingError } from './errors';
import { consumeRateLimit } from './rate-limit';
import { z } from 'zod';
import { requireSession, type SessionInfo } from '@/lib/auth';

export type ActionResult<T = null> =
  | { ok: true; data: T }
  /** `code` permite ao client traduzir a mensagem em vez de exibir a do servidor. */
  | { ok: false; error: string; code?: string; fieldErrors?: Record<string, string[]> };

/** Violação de FK do Postgres (23503) — inclusive embrulhada pelo drizzle. */
export function isFkViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  if (code === '23503') return true;
  return isFkViolation((err as { cause?: unknown }).cause);
}

export type { SessionInfo };

/**
 * Padrão de toda mutation: valida sessão → valida input com zod → executa.
 * Erros viram { ok:false } tipado em vez de exceção vazando para o client.
 */
export async function runAuthedAction<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  handler: (data: z.infer<S>, session: SessionInfo) => Promise<T>,
): Promise<ActionResult<T>> {
  let session: SessionInfo;
  try {
    session = await requireSession();
  } catch {
    return { ok: false, error: 'Sessão expirada — faça login novamente.' };
  }

  if (session.workspaceStatus !== 'active') return { ok: false, error: 'Workspace suspenso. Apenas leitura disponível.' };
  if (!await consumeRateLimit('tenant:actor', session.userId)) return { ok: false, error: 'Muitas ações. Aguarde um minuto.' };

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error);
    return {
      ok: false,
      error: 'Dados inválidos.',
      fieldErrors: flat.fieldErrors as Record<string, string[]>,
    };
  }

  try {
    const data = await handler(parsed.data, session);
    return { ok: true, data };
  } catch (err) {
    if (err instanceof UserFacingError) return { ok: false, error: err.message, code: err.code };
    const ref = randomUUID();
    console.error('[action]', ref, err instanceof Error ? err.name : 'UnknownError');
    return { ok: false, error: `Não foi possível concluir a ação (ref. ${ref}).` };
  }
}
