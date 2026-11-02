// Money is whole cents and hours are whole minutes, so every sum is exact.

/** "36.50", "R36.50", "36.5", "R 1 131.50" -> cents. Throws on anything else. */
export function parseRand(text: string): number {
  const s = text.trim().replace(/^R\s*/i, '').replace(/[\s,]/g, '');
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`Not a rand amount: "${text}"`);
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/** 113150 -> "R1131.50" (no thousands separator, as on the HRM-05). */
export function formatRand(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) throw new RangeError(`Not an amount: ${cents} cents`);
  return `R${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/**
 * Rule 10: hours x rate, rounded half-up to the cent, in exact whole-number
 * arithmetic. 36.25 h x R36.50 = R1323.125 -> R1323.13.
 *
 * amount in cents = minutes x rateCents / 60; adding 30 before the whole-number
 * division by 60 is "add half a cent, then drop the fraction", i.e. half-up.
 */
export function amountCents(minutes: number, rateCents: number): number {
  if (!Number.isInteger(minutes) || !Number.isInteger(rateCents) || minutes < 0 || rateCents < 0) {
    throw new RangeError('Hours and rate must be whole, non-negative minutes and cents');
  }
  return Math.floor((minutes * rateCents + 30) / 60);
}

/** Minutes -> hours as written on the form: 240 -> "4", 210 -> "3.5", 2175 -> "36.25". */
export function formatHours(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0) throw new RangeError(`Not a duration: ${minutes} minutes`);
  const whole = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return String(whole);
  if (rest % 15 !== 0) throw new RangeError(`${minutes} minutes is not a whole quarter hour`);
  const fraction = { 15: '25', 30: '5', 45: '75' }[rest as 15 | 30 | 45];
  return `${whole}.${fraction}`;
}
