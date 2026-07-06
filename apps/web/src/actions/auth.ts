'use server';

import { AuthError } from 'next-auth';
import { signIn, signOut } from '@/lib/auth';

export async function loginAction(_prevState: string | undefined, formData: FormData) {
  try {
    await signIn('credentials', {
      email: formData.get('email'),
      password: formData.get('password'),
      redirectTo: '/',
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return 'E-mail ou senha inválidos.';
    }
    throw error; // NEXT_REDIRECT passa por aqui
  }
}

export async function logoutAction() {
  await signOut({ redirectTo: '/login' });
}
