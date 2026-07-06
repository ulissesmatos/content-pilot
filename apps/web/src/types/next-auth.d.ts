import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      workspaceId: string;
    } & DefaultSession['user'];
  }

  interface User {
    workspaceId?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string;
    workspaceId?: string;
  }
}
