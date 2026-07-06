/** Datas por locale usadas em prompts e queries ("julho de 2026" / "July 2026"). */

export function monthYear(locale: string, date: Date = new Date()): string {
  return date.toLocaleString(locale, { month: 'long', year: 'numeric' });
}

export function prevMonthYear(locale: string, date: Date = new Date()): string {
  return monthYear(locale, new Date(date.getFullYear(), date.getMonth() - 1, 1));
}

export function todayLong(locale: string, date: Date = new Date()): string {
  return date.toLocaleDateString(locale, { day: '2-digit', month: 'long', year: 'numeric' });
}
