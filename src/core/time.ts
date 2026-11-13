// Times are whole minutes since midnight (18:30 -> 1110). Whole numbers only,
// so there is never any floating-point drift in hours or money.

export const MINUTES_PER_DAY = 24 * 60;

/**
 * Reads a clock time as typed in the sources: "18:30", "18:30:00", "18H30",
 * "6:30 PM", "1830". Seconds are ignored. Returns null if it isn't a time.
 */
export function parseTime(text: string): number | null {
  const s = text.trim().toUpperCase().replace(/\s+/g, ' ');
  const m =
    /^(\d{1,2})[:H.](\d{2})(?::\d{2})?(?: ?([AP])\.?M\.?)?$/.exec(s) ??
    /^(\d{2})(\d{2})()$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ampm = m[3];
  if (min > 59) return null;
  if (ampm) {
    if (h < 1 || h > 12) return null;
    if (h === 12) h = 0;
    if (ampm === 'P') h += 12;
  }
  if (h > 23) return null;
  return h * 60 + min;
}

/**
 * 1110 -> "18H30", the way the HRM-05 has always been written. Midnight at the
 * end of the day (1440, the latest a line may end, rule 5) is written "00H00".
 */
export function formatTime(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MINUTES_PER_DAY) {
    throw new RangeError(`Not a time of day: ${minutes} minutes`);
  }
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}H${String(m).padStart(2, '0')}`;
}

/**
 * Rule 2, start times (SI Administrator, 13 Nov 2026): :45-:14 -> :00 (:45-:59
 * go to the next hour), :15-:44 -> :30. A start exactly on :15 or :45
 * therefore goes forward: 15H15 -> 15H30, 15H45 -> 16H00.
 */
export function roundStart(minutes: number): number {
  const hour = Math.floor(minutes / 60) * 60;
  const m = minutes % 60;
  if (m <= 14) return hour;
  if (m <= 44) return hour + 30;
  return hour + 60;
}

/**
 * Rule 5's latest end time in minutes. "00H00" (or "24H00") means midnight at
 * the end of the day, 1440, not the start of it.
 */
export function latestEndMinutes(text: string): number {
  const t = text.trim().toUpperCase();
  if (/^24[:H.]?00$/.test(t)) return MINUTES_PER_DAY;
  const m = parseTime(t);
  if (m === null) throw new Error(`Latest end time "${text}" is not a time`);
  return m === 0 ? MINUTES_PER_DAY : m;
}

/**
 * Rule 2, end times: :45-:14 -> :00 (:45-:59 go to the next hour), :15-:44 -> :30.
 * An end exactly on :15 or :45 therefore goes forward.
 * May return 1440 (midnight, written 00H00) for ends from 23:45.
 */
export function roundEnd(minutes: number): number {
  const hour = Math.floor(minutes / 60) * 60;
  const m = minutes % 60;
  if (m <= 14) return hour;
  if (m <= 44) return hour + 30;
  return hour + 60;
}
