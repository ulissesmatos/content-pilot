import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { compare } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { getDb, users } from '@content-pilot/db';
import { z } from 'zod';
import { authConfig } from './auth.config';
import { checkLoginRateLimit, registerLoginFailure, registerLoginSuccess } from './rate-limit';

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

        // Anti brute-force: bloqueia tentativas depois de N falhas seguidas.
        if (!checkLoginRateLimit(email)) return null;

        const db = getDb();
        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (!user) {
          registerLoginFailure(email);
          return null;
        }

        const valid = await compare(parsed.data.password, user.passwordHash);
        if (!valid) {
          registerLoginFailure(email);
          return null;
        }

        registerLoginSuccess(email);
        return {
          id: user.id,
          email: user.email,
          name: user.name ?? user.email,
          workspaceId: user.workspaceId,
          role: user.role,
        };
      },
    }),
  ],
});

/** Sessão obrigatória: lança se não autenticado (uso em server actions/RSC). */
export async function requireSession() {
  const session = await auth();
  const user = session?.user as { workspaceId?: string; role?: 'owner' | 'admin' } | undefined;
  if (!session?.user?.id || !user?.workspaceId) {
    throw new Error('Não autenticado');
  }
  return {
    userId: session.user.id,
    workspaceId: user.workspaceId,
    email: session.user.email ?? '',
    role: user.role ?? ('owner' as const),
  };
}

/** Sessão de admin da plataforma obrigatória (credenciais globais, etc.). */
export async function requireAdmin() {
  const session = await requireSession();
  if (session.role !== 'admin') throw new Error('Apenas administradores da plataforma.');
  return session;
}
