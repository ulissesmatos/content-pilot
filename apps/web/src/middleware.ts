import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth.config';

// Middleware usa a config sem banco: só valida o JWT da sessão.
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.svg$).*)'],
};
