import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { compare } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { getDb, users } from '@content-pilot/db';
import { z } from 'zod';
import { authConfig } from './auth.config';

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

        const db = getDb();
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, parsed.data.email.toLowerCase()))
          .limit(1);
        if (!user) return null;

        const valid = await compare(parsed.data.password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? user.email,
          workspaceId: user.workspaceId,
        };
      },
    }),
  ],
});

/** Sessão obrigatória: lança se não autenticado (uso em server actions/RSC). */
export async function requireSession() {
  const session = await auth();
  const workspaceId = (session?.user as { workspaceId?: string } | undefined)?.workspaceId;
  if (!session?.user?.id || !workspaceId) {
    throw new Error('Não autenticado');
  }
  return { userId: session.user.id, workspaceId, email: session.user.email ?? '' };
}
