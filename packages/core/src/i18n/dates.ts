/** Datas por locale usadas em prompts e queries ("julho de 2026" / "July 2026"). */

/**
 * Fuso em que o sistema mostra e calcula datas (UTC-3). O banco continua em UTC; este é o fuso do
 * LEITOR. Sem ele, um servidor em UTC mostra a data do dia seguinte entre 21h e meia-noite, e o
 * artigo sairia com o "hoje" errado.
 */
export const APP_TIME_ZONE = 'America/Sao_Paulo';

/** Ano e mês (1 a 12) de um instante, no fuso pedido. */
function yearMonthIn(date: Date, timeZone: string): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric' }).formatToParts(date);
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: pick('year'), month: pick('month') };
}

export function monthYear(locale: string, date: Date = new Date(), timeZone: string = APP_TIME_ZONE): string {
  return date.toLocaleString(locale, { month: 'long', year: 'numeric', timeZone });
}

export function prevMonthYear(locale: string, date: Date = new Date(), timeZone: string = APP_TIME_ZONE): string {
  const { year, month } = yearMonthIn(date, timeZone);
  // meio do mês anterior ao meio-dia UTC: nenhum fuso o empurra para outro mês
  return monthYear(locale, new Date(Date.UTC(year, month - 2, 15, 12)), 'UTC');
}

export function todayLong(locale: string, date: Date = new Date(), timeZone: string = APP_TIME_ZONE): string {
  return date.toLocaleDateString(locale, { day: '2-digit', month: 'long', year: 'numeric', timeZone });
}
