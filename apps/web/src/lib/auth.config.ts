import type { NextAuthConfig } from 'next-auth';

/**
 * Rotas que funcionam sem sessão. Os fluxos de e-mail precisam estar aqui: o
 * link chega justamente para quem não consegue entrar.
 */
const PUBLIC_PREFIXES = ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email'];

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
      const isLoggedIn = !!auth?.user?.id;
      const isPublic = PUBLIC_PREFIXES.some((prefix) => nextUrl.pathname.startsWith(prefix));
      if (isPublic) {
        // `?blocked=1` = conta bloqueada com cookie ainda válido. Sem esta
        // exceção o par (layout manda para /login, middleware devolve para /)
        // vira loop infinito.
        const isBlockedNotice = nextUrl.searchParams.has('blocked');
        // Um link de e-mail carrega token e precisa ser processado mesmo com
        // sessão viva: redirecionar para / descartaria a confirmação.
        const carriesToken = nextUrl.searchParams.has('token');
        if (isLoggedIn && !isBlockedNotice && !carriesToken) {
          return Response.redirect(new URL('/', nextUrl));
        }
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
        // Carimbo do login. `requireSession` compara com users.sessions_valid_from
        // para descartar sessões anteriores a uma troca de senha — sem ele, o
        // JWT sobreviveria à própria troca que deveria matá-lo.
        token.loginAt = Date.now();
      }
      return token;
    },
    session({ session, token }) {
      if (token.userId) session.user.id = token.userId as string;
      (session.user as { workspaceId?: string }).workspaceId = token.workspaceId as string;
      (session.user as { role?: 'owner' | 'admin' }).role = (token.role as 'owner' | 'admin') ?? 'owner';
      (session.user as { loginAt?: number }).loginAt = token.loginAt as number | undefined;
      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
