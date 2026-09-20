import { APP_TIME_ZONE } from '@content-pilot/core/client';

/**
 * Formatação de data e hora do painel. O banco guarda tudo em UTC; a tela mostra em UTC-3
 * (`APP_TIME_ZONE`). Sem o fuso explícito, um servidor em UTC mostraria 10:00 para uma
 * descoberta agendada às 07:00, e um componente de cliente daria outra hora no navegador
 * (e um erro de hidratação).
 */
export { APP_TIME_ZONE };

export function dateTimeFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, { timeZone: APP_TIME_ZONE, ...options });
}
