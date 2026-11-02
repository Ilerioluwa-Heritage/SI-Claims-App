// Turning what's typed or stored in the uploaded files into dates, times and
// column names the rules understand.

/** Column headings compared without case, spaces or punctuation: "Date:" = "date". */
export const plainHeading = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** "Monday 06/10/2026" -> "2026-10-06" (day first); null if there's no real date in it. */
export function readDate(text: string): string | null {
  const m = /(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4})/.exec(text);
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = month === 2 && leap ? 29 : DAYS_IN_MONTH[month - 1];
  if (!days || day < 1 || day > days) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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
