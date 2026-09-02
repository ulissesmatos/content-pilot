import type { NextAuthConfig } from 'next-auth';

/**
 * Config sem dependência de banco — usada também pelo middleware.
 * O provider Credentials (que consulta o Postgres) entra só em auth.ts.
 */
export const authConfig = {
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isPublic =
        nextUrl.pathname.startsWith('/login') || nextUrl.pathname.startsWith('/register');
      if (isPublic) {
        if (isLoggedIn) return Response.redirect(new URL('/', nextUrl));
        return true;
      }
      if (nextUrl.pathname.startsWith('/admin')) {
        if (!isLoggedIn) return false;
        // Gate apenas de UX: o JWT não revalida, então o cargo aqui pode estar
        // velho (rebaixado depois do login). A autorização real é o
        // requireAdmin() no layout de /admin e dentro de cada admin action.
        const role = (auth?.user as { role?: string } | undefined)?.role;
        if (role !== 'admin') return Response.redirect(new URL('/', nextUrl));
        return true;
      }
      return isLoggedIn;
    },
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.workspaceId = (user as { workspaceId?: string }).workspaceId;
        token.role = (user as { role?: 'owner' | 'admin' }).role ?? 'owner';
      }
      return token;
    },
    session({ session, token }) {
      if (token.userId) session.user.id = token.userId as string;
      (session.user as { workspaceId?: string }).workspaceId = token.workspaceId as string;
      (session.user as { role?: 'owner' | 'admin' }).role = (token.role as 'owner' | 'admin') ?? 'owner';
      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
