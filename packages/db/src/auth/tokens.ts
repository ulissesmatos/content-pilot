import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db, Tx } from '../client';
import { authTokens } from '../schema';

/**
 * Tokens de uso único para os links enviados por e-mail.
 *
 * O valor sorteado só existe no link. O banco guarda o SHA-256 — sem salt de
 * propósito: são 32 bytes aleatórios, não uma senha adivinhável, e o hash
 * precisa ser determinístico para virar chave de busca.
 */

export type AuthTokenType = 'password_reset' | 'email_verify';

export const TOKEN_TTL_MS: Record<AuthTokenType, number> = {
  // janela curta: o link troca a senha sem pedir a antiga
  password_reset: 60 * 60 * 1000,
  email_verify: 24 * 60 * 60 * 1000,
};

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Emite um token novo e derruba os anteriores do mesmo tipo.
 *
 * Pedir de novo tem que invalidar o link antigo: dois links vivos dobram a
 * janela de quem interceptou o primeiro e-mail.
 */
export async function issueAuthToken(
  db: Db,
  opts: { userId: string; type: AuthTokenType; ip?: string | null },
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.transaction(async (tx: Tx) => {
    await tx
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(authTokens.userId, opts.userId),
          eq(authTokens.type, opts.type),
          isNull(authTokens.usedAt),
        ),
      );
    await tx.insert(authTokens).values({
      userId: opts.userId,
      type: opts.type,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS[opts.type]),
      requestedIp: opts.ip ?? null,
    });
  });
  return token;
}

/**
 * Gasta o token e devolve de quem era, ou null.
 *
 * O UPDATE condicional é o que garante uso único: dois cliques simultâneos
 * disputam a mesma linha e só um encontra `used_at IS NULL`. Conferir antes e
 * marcar depois deixaria essa corrida aberta.
 */
export async function consumeAuthToken(
  db: Db,
  token: string,
  type: AuthTokenType,
): Promise<{ userId: string } | null> {
  if (!token || token.length > 200) return null;
  const rows = await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authTokens.tokenHash, hashToken(token)),
        eq(authTokens.type, type),
        isNull(authTokens.usedAt),
        sql`${authTokens.expiresAt} > now()`,
      ),
    )
    .returning({ userId: authTokens.userId });
  return rows[0] ? { userId: rows[0].userId } : null;
}

/** Limpeza oportunista: tokens gastos/expirados não servem para mais nada. */
export async function pruneExpiredAuthTokens(db: Db): Promise<void> {
  await db.execute(
    sql`delete from auth_tokens where id in (
      select id from auth_tokens where expires_at < now() - interval '7 days' limit 200)`,
  );
}
