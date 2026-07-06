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
      const isOnLogin = nextUrl.pathname.startsWith('/login');
      if (isOnLogin) {
        if (isLoggedIn) return Response.redirect(new URL('/', nextUrl));
        return true;
      }
      return isLoggedIn;
    },
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.workspaceId = (user as { workspaceId?: string }).workspaceId;
      }
      return token;
    },
    session({ session, token }) {
      if (token.userId) session.user.id = token.userId as string;
      (session.user as { workspaceId?: string }).workspaceId = token.workspaceId as string;
      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
