import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { APP_TIME_ZONE } from '@/lib/datetime';
import { defaultLocale, isLocale, LOCALE_COOKIE, locales } from './config';

/**
 * Locale por cookie (preferência explícita do usuário) com fallback para o
 * Accept-Language do navegador e, por fim, o default. Sem prefixo de rota —
 * as URLs do painel não mudam com o idioma.
 */
export default getRequestConfig(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);

  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;
  let locale = fromCookie && isLocale(fromCookie) ? fromCookie : null;

  if (!locale) {
    const accept = headerStore.get('accept-language') ?? '';
    for (const part of accept.split(',')) {
      const tag = part.split(';')[0]!.trim();
      const match = locales.find((l) => l.toLowerCase() === tag.toLowerCase() || tag.toLowerCase().startsWith(l.split('-')[0]!.toLowerCase()));
      if (match) {
        locale = match;
        break;
      }
    }
  }

  const resolved = locale ?? defaultLocale;
  return {
    locale: resolved,
    // o banco guarda UTC; o painel mostra UTC-3
    timeZone: APP_TIME_ZONE,
    messages: (await import(`../../messages/${resolved}.json`)).default,
  };
});
