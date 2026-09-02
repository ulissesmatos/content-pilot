import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { compare } from 'bcryptjs';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, users, workspaces } from '@content-pilot/db';
import { z } from 'zod';
import { authConfig } from './auth.config';
import { checkLoginRateLimit, registerLoginFailure, registerLoginSuccess } from './rate-limit';
import { isSuperAdmin } from './super-admin';
import { clientIp } from './request-context';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: {},
        password: {},
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const email = parsed.data.email.toLowerCase();
        // o IP é best-effort: sem proxy na frente ele pode faltar
        const ip = await clientIp().catch(() => null);

        // Anti brute-force: bloqueia por conta e por origem.
        if (!checkLoginRateLimit(email, ip)) return null;

        const db = getDb();
        const [user] = await db
          .select()
          .from(users)
          .where(and(eq(users.email, email), isNull(users.deletedAt)))
          .limit(1);
        if (!user) {
          registerLoginFailure(email, ip);
          return null;
        }

        const valid = await compare(parsed.data.password, user.passwordHash);
        if (!valid) {
          registerLoginFailure(email, ip);
          return null;
        }

        // Conta suspensa/banida: senha correta, acesso negado. O super admin
        // passa mesmo assim — é a única porta de volta se o status for
        // alterado à mão no banco.
        if (!isSuperAdmin(user.email) && user.status !== 'active') {
          registerLoginFailure(email, ip);
          return null;
        }

        registerLoginSuccess(email);
        await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
        invalidateUserCache(user.id);

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? user.email,
          workspaceId: user.workspaceId,
          role: isSuperAdmin(user.email) ? 'admin' : user.role,
        };
      },
    }),
  ],
});

/**
 * O JWT do next-auth não revalida sozinho: sem isto, um usuário banido (ou um
 * admin rebaixado) continuaria com sessão válida até o token expirar. Toda
 * request relê o essencial do banco, com cache curto para não pagar uma ida
 * ao banco por render.
 *
 * Consequência: o `role` do JWT vale como dica de UX para o middleware; o
 * `role` do banco é a verdade de autorização.
 */
const FRESHNESS_TTL_MS = 60_000;

interface FreshUser {
  id: string;
  workspaceId: string;
  email: string;
  role: 'owner' | 'admin';
  status: 'active' | 'suspended' | 'banned';
  deleted: boolean;
  workspaceStatus: 'active' | 'suspended';
}

const freshCache = new Map<string, { at: number; value: FreshUser | null }>();

/** Chamar após mudar cargo/status/e-mail de um usuário para valer na hora. */
export function invalidateUserCache(userId: string): void {
  freshCache.delete(userId);
}

async function loadFreshUser(userId: string): Promise<FreshUser | null> {
  const db = getDb();
  const [row] = await db
    .select({
      id: users.id,
      workspaceId: users.workspaceId,
      email: users.email,
      role: users.role,
      status: users.status,
      deletedAt: users.deletedAt,
      workspaceStatus: workspaces.status,
    })
    .from(users)
    .innerJoin(workspaces, eq(workspaces.id, users.workspaceId))
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    email: row.email,
    // o super admin é sempre admin, mesmo que a linha diga outra coisa
    role: isSuperAdmin(row.email) ? 'admin' : row.role,
    status: row.status,
    deleted: row.deletedAt !== null,
    workspaceStatus: row.workspaceStatus,
  };
}

async function getFreshUser(userId: string): Promise<FreshUser | null> {
  const cached = freshCache.get(userId);
  if (cached && Date.now() - cached.at < FRESHNESS_TTL_MS) return cached.value;
  const value = await loadFreshUser(userId);
  freshCache.set(userId, { at: Date.now(), value });
  return value;
}

/**
 * Conta autenticada porém bloqueada (suspensa/banida/excluída). Separada do
 * "não autenticado" porque o tratamento é outro: o cookie dela ainda é
 * válido, então mandá-la para /login sem mais nada geraria loop — o
 * middleware veria sessão viva e devolveria para /.
 */
export class AccountBlockedError extends Error {
  constructor() {
    super('Esta conta está indisponível. Fale com o suporte.');
    this.name = 'AccountBlockedError';
  }
}

export interface SessionInfo {
  userId: string;
  workspaceId: string;
  email: string;
  role: 'owner' | 'admin';
  isSuperAdmin: boolean;
  workspaceStatus: 'active' | 'suspended';
}

/** Sessão obrigatória: lança se não autenticado (uso em server actions/RSC). */
export async function requireSession(): Promise<SessionInfo> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error('Não autenticado');

  const fresh = await getFreshUser(userId);
  if (!fresh) throw new Error('Não autenticado');

  const superAdmin = isSuperAdmin(fresh.email);
  if (!superAdmin && (fresh.deleted || fresh.status !== 'active')) {
    throw new AccountBlockedError();
  }

  return {
    userId: fresh.id,
    workspaceId: fresh.workspaceId,
    email: fresh.email,
    role: fresh.role,
    isSuperAdmin: superAdmin,
    workspaceStatus: fresh.workspaceStatus,
  };
}

/** Sessão de admin da plataforma obrigatória (painel /admin, chaves globais). */
export async function requireAdmin(): Promise<SessionInfo> {
  const session = await requireSession();
  if (session.role !== 'admin') throw new Error('Apenas administradores da plataforma.');
  return session;
}

/**
 * Só o super admin (ADMIN_EMAIL do .env): cargos, isenção de cobrança,
 * segredos da plataforma, planos e perfis de modelo.
 */
export async function requireSuperAdmin(): Promise<SessionInfo> {
  const session = await requireSession();
  if (!session.isSuperAdmin) throw new Error('Apenas o super administrador.');
  return session;
}
