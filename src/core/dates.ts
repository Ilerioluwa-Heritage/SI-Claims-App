// Dates are kept as "YYYY-MM-DD" text, never Date objects, so nothing can
// shift with time zones.

export const MONTH_NAMES = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
] as const;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Day, month (1-12) and year -> "2026-10-06"; null if there's no such day. */
export function isoDate(day: number, month: number, year: number): string | null {
  if (![day, month, year].every(Number.isInteger) || year < 1900 || year > 2999) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = month === 2 && leap ? 29 : DAYS_IN_MONTH[month - 1];
  if (!days || day < 1 || day > days) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** "October", "oct", "OCTOBER" -> 10; null if it isn't a month. */
export function monthNumber(word: string): number | null {
  const w = word.trim().slice(0, 3).toUpperCase();
  if (w.length !== 3) return null;
  const i = MONTH_NAMES.findIndex((m) => m.startsWith(w));
  return i >= 0 ? i + 1 : null;
}
