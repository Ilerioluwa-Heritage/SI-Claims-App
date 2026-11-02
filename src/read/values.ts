// Turning what's typed or stored in the uploaded files into dates, times and
// column names the rules understand.

import { isoDate } from '../core/dates.ts';

/** Column headings compared without case, spaces or punctuation: "Date:" = "date". */
export const plainHeading = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** "Monday 06/10/2026" -> "2026-10-06" (day first); null if there's no real date in it. */
export function readDate(text: string): string | null {
  const m = /(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4})/.exec(text);
  return m ? isoDate(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

/** An Excel date number (46301 = 6 Oct 2026) -> "2026-10-06". Any time of day is ignored. */
export function excelDate(serial: number): string {
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** An Excel time (a fraction of a day, 0.75 = 18:00) -> minutes since midnight. */
export function excelTime(value: number): number {
  return Math.round((value - Math.floor(value)) * 24 * 60) % (24 * 60);
}
