import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      workspaceId: string;
      role: 'owner' | 'admin';
    } & DefaultSession['user'];
  }

  interface User {
    workspaceId?: string;
    role?: 'owner' | 'admin';
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string;
    workspaceId?: string;
    role?: 'owner' | 'admin';
  }
}
