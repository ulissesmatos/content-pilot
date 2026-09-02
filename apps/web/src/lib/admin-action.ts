import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { auditLogs, getDb, type Tx } from '@content-pilot/db';
import { requireAdmin, type SessionInfo } from '@/lib/auth';
import { requestContext } from '@/lib/request-context';
import { consumeRateLimit } from '@/lib/rate-limit';
import { UserFacingError } from '@/lib/errors';
import type { ActionResult } from '@/lib/action-utils';

/**
 * Borda única de toda mutação do painel admin.
 *
 * Diferente do `runAuthedAction`, aqui o operador mexe em dados de TERCEIROS.
 * Por isso três coisas são obrigatórias e não opcionais:
 *  - o cargo é relido do banco a cada chamada (`requireAdmin`), nunca do JWT;
 *  - tudo roda numa transação junto com a linha de auditoria — sem ação, sem
 *    log; sem log, sem ação;
 *  - a mensagem de erro devolvida é sanitizada: só um UserFacingError chega
 *    ao cliente, o resto vira genérico com um id de correlação no log.
 */

export type AuditTargetType =
  | 'user'
  | 'workspace'
  | 'plan'
  | 'subscription'
  | 'credential'
  | 'settings'
  | 'model_profile';

export interface AdminActionMeta {
  /** Verbo pontilhado gravado na auditoria: 'user.suspend', 'plan.update'. */
  action: string;
  targetType: AuditTargetType;
  /** Cargos, isenção de cobrança, segredos, planos e perfis de modelo. */
  superAdminOnly?: boolean;
}

export interface AdminAuditPatch {
  targetId?: string | null;
  workspaceId?: string | null;
  /** Normalmente { before, after }. Redigido antes de gravar. */
  diff?: unknown;
}

export interface AdminHandlerContext {
  tx: Tx;
  session: SessionInfo;
  /** Descreve alvo e diff para a auditoria. Pode ser chamado mais de uma vez. */
  audit: (patch: AdminAuditPatch) => void;
}

/** Campos cujo valor nunca pode ir para a auditoria. */
const SECRET_KEY_RE = /(secret|password|passwd|token|api[-_]?key|private|ciphertext|credential)/i;
/** Identificadores que casam com o regex acima mas não são segredo. */
const NOT_SECRET = new Set([
  'keyId',
  'key_id',
  'maskedHint',
  'masked_hint',
  'stripePriceId',
  'stripe_price_id',
  'stripeCustomerId',
  'stripe_customer_id',
  'stripeSubscriptionId',
  'stripe_subscription_id',
  'credentialId',
  'credential_id',
]);

const MAX_DIFF_CHARS = 8_000;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[aninhado demais]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = !NOT_SECRET.has(k) && SECRET_KEY_RE.test(k) ? '***' : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

function safeDiff(diff: unknown): unknown {
  if (diff === undefined) return null;
  const redacted = redact(diff);
  const serialized = JSON.stringify(redacted);
  if (serialized && serialized.length > MAX_DIFF_CHARS) {
    return { truncated: true, preview: serialized.slice(0, MAX_DIFF_CHARS) };
  }
  return redacted;
}

/** Só a mensagem de um UserFacingError chega ao cliente. */
function toActionError(err: unknown, correlationId: string): { error: string; code?: string } {
  if (err instanceof UserFacingError) return { error: err.message, code: err.code };
  return {
    error: `Não foi possível concluir a ação (ref. ${correlationId}).`,
    code: 'admin.unexpected',
  };
}

export async function runAdminAction<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  meta: AdminActionMeta,
  handler: (data: z.infer<S>, ctx: AdminHandlerContext) => Promise<T>,
): Promise<ActionResult<T>> {
  let session: SessionInfo;
  try {
    session = await requireAdmin();
  } catch {
    return { ok: false, error: 'Acesso restrito a administradores.', code: 'admin.forbidden' };
  }

  if (meta.superAdminOnly && !session.isSuperAdmin) {
    return {
      ok: false,
      error: 'Esta ação é exclusiva do super administrador.',
      code: 'admin.superAdminOnly',
    };
  }

  if (!consumeRateLimit('admin:actor', session.userId)) {
    return {
      ok: false,
      error: 'Muitas ações em pouco tempo. Aguarde um instante.',
      code: 'admin.rateLimited',
    };
  }

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error);
    return {
      ok: false,
      error: 'Dados inválidos.',
      code: 'admin.invalid',
      fieldErrors: flat.fieldErrors as Record<string, string[]>,
    };
  }

  const { ip, userAgent } = await requestContext().catch(() => ({ ip: null, userAgent: null }));
  const correlationId = randomUUID().slice(0, 8);

  try {
    return await getDb().transaction(async (tx) => {
      let patch: AdminAuditPatch = {};
      const data = await handler(parsed.data, {
        tx,
        session,
        audit: (next) => {
          patch = { ...patch, ...next };
        },
      });

      await tx.insert(auditLogs).values({
        actorUserId: session.userId,
        actorEmail: session.email,
        actorRole: session.isSuperAdmin ? 'super_admin' : session.role,
        action: meta.action,
        targetType: meta.targetType,
        targetId: patch.targetId ?? null,
        workspaceId: patch.workspaceId ?? null,
        diff: safeDiff(patch.diff),
        ip,
        userAgent,
      });

      return { ok: true as const, data };
    });
  } catch (err) {
    console.error(`[admin:${meta.action}] ref=${correlationId}`, err);
    return { ok: false, ...toActionError(err, correlationId) };
  }
}
