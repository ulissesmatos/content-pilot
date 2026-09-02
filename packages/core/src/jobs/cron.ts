import { CronExpressionParser } from 'cron-parser';

/**
 * Próxima execução de uma expressão cron no timezone dado. Fonte única — a
 * mesma conta vivia no scheduler do worker e (duplicada 2x) nas actions da web.
 */
export function nextRunAt(cron: string, timezone: string, from = new Date()): Date {
  const interval = CronExpressionParser.parse(cron, { currentDate: from, tz: timezone });
  return interval.next().toDate();
}
