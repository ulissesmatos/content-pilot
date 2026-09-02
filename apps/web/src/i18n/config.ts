/**
 * Idiomas do painel. Para adicionar um idioma novo:
 * 1. Crie `messages/<locale>.json` (copie o en.json e traduza).
 * 2. Adicione o código aqui em `locales` e o rótulo em `LOCALE_LABELS`.
 * Nada mais — o seletor de idioma e o request config leem esta lista.
 */
export const locales = ['pt-BR', 'en'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'pt-BR';

export const LOCALE_LABELS: Record<Locale, string> = {
  'pt-BR': 'Português (Brasil)',
  en: 'English',
};

export const LOCALE_COOKIE = 'locale';

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}
