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

/** 1110 -> "18H30", the way the HRM-05 has always been written. */
export function formatTime(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= MINUTES_PER_DAY) {
    throw new RangeError(`Not a time of day: ${minutes} minutes`);
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}H${String(m).padStart(2, '0')}`;
}

/**
 * Rule 2, start times: :46-:15 -> :00 (:46-:59 go to the next hour), :16-:45 -> :30.
 * A start exactly on :15 or :45 therefore goes back.
 */
export function roundStart(minutes: number): number {
  const hour = Math.floor(minutes / 60) * 60;
  const m = minutes % 60;
  if (m <= 15) return hour;
  if (m <= 45) return hour + 30;
  return hour + 60;
}

/**
 * Rule 2, end times: :45-:14 -> :00 (:45-:59 go to the next hour), :15-:44 -> :30.
 * An end exactly on :15 or :45 therefore goes forward.
 * May return 1440 (midnight) for ends from 23:45; rule 5 pulls that back.
 */
export function roundEnd(minutes: number): number {
  const hour = Math.floor(minutes / 60) * 60;
  const m = minutes % 60;
  if (m <= 14) return hour;
  if (m <= 44) return hour + 30;
  return hour + 60;
}
