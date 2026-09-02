'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { isLocale, LOCALE_COOKIE } from '@/i18n/config';

/** Troca o idioma do painel (cookie de 1 ano) e re-renderiza tudo. */
export async function setLocaleAction(locale: string): Promise<void> {
  if (!isLocale(locale)) return;
  const store = await cookies();
  // httpOnly: só o servidor lê este cookie (i18n/request.ts); nenhum script
  // do client precisa dele, então não há motivo para expô-lo ao DOM.
  store.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  });
  revalidatePath('/', 'layout');
}
