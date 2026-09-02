import { z } from 'zod';
import { requireSession } from '@/lib/auth';

export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/** Violação de FK do Postgres (23503) — inclusive embrulhada pelo drizzle. */
export function isFkViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  if (code === '23503') return true;
  return isFkViolation((err as { cause?: unknown }).cause);
}

interface SessionInfo {
  userId: string;
  workspaceId: string;
  email: string;
  role: 'owner' | 'admin';
}

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
    console.error('[action]', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Erro inesperado.' };
  }
}
