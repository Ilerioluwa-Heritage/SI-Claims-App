// The claim rules (numbered as in the brief). Pure functions only: no files,
// no network, no dates from the clock. The website, the phone app and the
// tests all call these same functions, so they cannot disagree.

import { amountCents } from './money.ts';
import type { AllowanceBand, Settings } from './settings.ts';
import { formatTime, parseTime, roundEnd, roundStart } from './time.ts';

/** One SI session from the daily register (rule 1: the register is the source of truth). */
export interface SiSession {
  /** "YYYY-MM-DD" */
  date: string;
  /** Raw start, minutes since midnight. */
  start: number;
  /** Raw end, minutes since midnight. 0 with a later start is read as midnight. */
  end: number;
  module?: string;
}

/** One lecture a SIL attended, from the lecturer's class attendance record. */
export interface ClassRecord {
  date: string;
  module: string;
  /** Raw lecture start, minutes since midnight. */
  start: number;
}

export type Service = 'SI SESSION' | 'CLASS ATTENDANCE';

/** One line on the HRM-05. */
export interface ClaimRow {
  /** "YYYY-MM-DD"; more than one when rows were combined to fit the form (rule 11). */
  dates: string[];
  service: Service;
  timeIn: string;
  timeOut: string;
  minutes: number;
}

/** How one SI session became a line, step by step, for the checks report. */
export interface SessionWorking {
  date: string;
  module?: string;
  rawStart: number;
  rawEnd: number;
  roundedStart: number;
  roundedEnd: number;
  prepMinutes: number;
  dataMinutes: number;
  /** Minutes moved onto the start to keep the end at or before the latest end time (rule 5). */
  movedToStart: number;
  finalStart: number;
  finalEnd: number;
  minutes: number;
}

export type NoteKind = 'invalid-session' | 'data-allowance' | 'midnight' | 'duplicate-class' | 'cap' | 'combined' | 'too-many-lines';

export interface Note {
  kind: NoteKind;
  message: string;
}

export interface ClaimResult {
  sessions: SessionWorking[];
  /** Lines in form order (SI sessions, then classes), combined if they didn't fit. */
  rows: ClaimRow[];
  /** False if even combining left more lines than the form holds: flagged, and no form is filled. */
  fitsOnForm: boolean;
  dataAllowanceHours: number;
  /** Sum of all lines before the monthly cap. */
  uncappedMinutes: number;
  /** Hours actually claimed, after the cap. */
  totalMinutes: number;
  capped: boolean;
  rateCents: number;
  amountCents: number;
  notes: Note[];
}

// ---------------------------------------------------------------------------
// Rule 4: data allowance
// ---------------------------------------------------------------------------

/** Hours of data allowance for a month with this many SI sessions (0 sessions -> 0). */
export function dataAllowanceHours(sessionCount: number, bands: AllowanceBand[]): number {
  let hours = 0;
  for (const band of [...bands].sort((a, b) => a.minSessions - b.minSessions)) {
    if (sessionCount >= band.minSessions) hours = band.hours;
  }
  return hours;
}

/**
 * Spreads the allowance one hour at a time over the sessions in date order:
 * the 1st session gets the 1st hour, the 2nd session the 2nd hour, and so on.
 * If there are more hours than sessions (only possible with 1 session and
 * 2 hours) it carries on from the first session again, so that session gets both.
 * Returns hours per session, in the same order as the sessions.
 */
export function spreadAllowance(hours: number, sessionCount: number): number[] {
  const perSession = new Array<number>(sessionCount).fill(0);
  for (let h = 0; h < hours && sessionCount > 0; h++) {
    perSession[h % sessionCount]! += 1;
  }
  return perSession;
}

// ---------------------------------------------------------------------------
// Rules 2, 3, 4, 5: one SI session -> one line
// ---------------------------------------------------------------------------

/**
 * Rounds the session (rule 2), adds the preparation and data hours to the end
 * (rules 3-5) and, if that would pass the latest end time, holds the end there
 * and moves the remainder onto the start instead (rule 5).
 */
export function workSession(
  session: SiSession,
  dataHours: number,
  settings: Settings,
): SessionWorking {
  const latestEnd = parseTime(settings.latestEndTime);
  if (latestEnd === null) throw new Error(`Latest end time "${settings.latestEndTime}" is not a time`);

  const rawEnd = session.end === 0 && session.start > 0 ? 24 * 60 : session.end;
  const roundedStart = roundStart(session.start);
  const roundedEnd = roundEnd(rawEnd);
  const prepMinutes = settings.prepHoursPerSession * 60;
  const dataMinutes = dataHours * 60;

  let finalEnd = roundedEnd + prepMinutes + dataMinutes;
  let finalStart = roundedStart;
  let movedToStart = 0;
  if (finalEnd > latestEnd) {
    movedToStart = finalEnd - latestEnd;
    finalEnd = latestEnd;
    finalStart = roundedStart - movedToStart;
  }
  if (finalStart < 0) throw new Error(`Session on ${session.date} cannot fit within one day`);

  return {
    date: session.date,
    module: session.module,
    rawStart: session.start,
    rawEnd,
    roundedStart,
    roundedEnd,
    prepMinutes,
    dataMinutes,
    movedToStart,
    finalStart,
    finalEnd,
    minutes: finalEnd - finalStart,
  };
}

/** A session is usable if it ends after it starts (an end of 00:00 counts as midnight). */
export function isValidSession(s: SiSession): boolean {
  const end = s.end === 0 && s.start > 0 ? 24 * 60 : s.end;
  return end > s.start;
}

// ---------------------------------------------------------------------------
// Rule 6: class attendance (SI Administrator, 2 Nov 2026)
// Classes come only from the lecturer's class attendance record; the SIL's own
// record isn't used. Times are the actual lecture start, not rounded.
// ---------------------------------------------------------------------------

/**
 * Each class the lecturer recorded is worth `classHours`, from the actual
 * lecture start (not rounded): 11H10 in, 13H10 out. Classes on the same day
 * share one line: "07H40/14H10" in, "09H40/16H10" out, hours added together.
 */
export function classRows(classes: ClassRecord[], settings: Settings, notes: Note[]): ClaimRow[] {
  const classMinutes = settings.classHours * 60;
  const byDate = new Map<string, number[]>();
  const seen = new Set<string>();
  for (const c of [...classes].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)) {
    // Same module, same day, starts in the same half hour: one class recorded twice.
    const key = `${c.date}|${roundStart(c.start)}|${c.module.toUpperCase().replace(/[^A-Z0-9]/g, '')}`;
    if (seen.has(key)) {
      notes.push({ kind: 'duplicate-class', message: `${c.module} on ${c.date} was recorded twice; counted once` });
      continue;
    }
    seen.add(key);
    byDate.set(c.date, [...(byDate.get(c.date) ?? []), c.start]);
  }
  return [...byDate].map(([date, starts]) => ({
    dates: [date],
    service: 'CLASS ATTENDANCE' as const,
    timeIn: starts.map(formatTime).join('/'),
    timeOut: starts.map((s) => formatTime(s + classMinutes)).join('/'),
    minutes: classMinutes * starts.length,
  }));
}

// ---------------------------------------------------------------------------
// Rule 11: fitting the form
// ---------------------------------------------------------------------------

/**
 * The form has 13 lines and there is never a second form (SI Administrator,
 * 3 Nov 2026). If there are more lines, class attendance lines with the same
 * time in and time out become one line first: dates joined with "&", hours
 * added. If that's still not enough, SI session lines with the same times are
 * combined the same way. A combined line sits where the first of its dates was.
 * If it still doesn't fit, it's flagged for the administrator to decide (for
 * example in the claim form editor); no line is ever dropped.
 */
export function combineRows(rows: ClaimRow[], rowsPerPage: number, notes: Note[]): ClaimRow[] {
  let result = rows;
  for (const service of ['CLASS ATTENDANCE', 'SI SESSION'] as const) {
    if (result.length <= rowsPerPage) break;
    result = combineService(result, service, notes);
  }
  if (result.length > rowsPerPage) {
    notes.push({
      kind: 'too-many-lines',
      message: `${result.length} lines even after combining lines with the same times; the form holds ${rowsPerPage}. This needs your decision before the form can be filled.`,
    });
  }
  return result;
}

/** Lines of one service with the same time in and time out, as one line. */
function combineService(rows: ClaimRow[], service: Service, notes: Note[]): ClaimRow[] {
  const groups = new Map<string, ClaimRow>();
  const out: ClaimRow[] = [];
  for (const r of rows) {
    if (r.service !== service) {
      out.push(r);
      continue;
    }
    const key = `${r.timeIn}|${r.timeOut}`;
    const g = groups.get(key);
    if (g) {
      g.dates = [...g.dates, ...r.dates];
      g.minutes += r.minutes;
    } else {
      const copy = { ...r, dates: [...r.dates] };
      groups.set(key, copy);
      out.push(copy);
    }
  }
  for (const g of groups.values()) {
    if (g.dates.length > 1) {
      notes.push({ kind: 'combined', message: `${g.service} ${g.timeIn}-${g.timeOut} on ${formatDates(g.dates)} combined into one line` });
    }
  }
  return out;
}

/** "2026-10-10" -> "10/10/2026"; several dates in one month -> "10&14&17/10/2026". */
export function formatDates(dates: string[]): string {
  const parts = dates.map((d) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    if (!m) throw new Error(`Not a date: "${d}"`);
    return { day: m[3]!, monthYear: `${m[2]}/${m[1]}` };
  });
  const first = parts[0];
  if (!first) return '';
  if (parts.every((p) => p.monthYear === first.monthYear)) {
    return `${parts.map((p) => p.day).join('&')}/${first.monthYear}`;
  }
  return parts.map((p) => `${p.day}/${p.monthYear}`).join('&');
}

// ---------------------------------------------------------------------------
// One SIL's month, all rules in order
// ---------------------------------------------------------------------------

/** `classes` are this SIL's lines from the lecturers' class attendance records. */
export function buildSilClaim(
  input: { sessions: SiSession[]; classes: ClassRecord[]; rateCents: number },
  settings: Settings,
): ClaimResult {
  const notes: Note[] = [];

  const valid: SiSession[] = [];
  for (const s of input.sessions) {
    if (isValidSession(s)) valid.push(s);
    else notes.push({ kind: 'invalid-session', message: `Session on ${s.date} ends before it starts; left out` });
  }
  valid.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);

  const allowance = dataAllowanceHours(valid.length, settings.dataAllowanceBands);
  const spread = spreadAllowance(allowance, valid.length);
  const sessions = valid.map((s, i) => workSession(s, spread[i]!, settings));
  if (allowance > 0) {
    const given = sessions.flatMap((w) => (w.dataMinutes ? [`${w.date} +${w.dataMinutes / 60}h`] : []));
    notes.push({
      kind: 'data-allowance',
      message: `${valid.length} sessions -> ${allowance}h data allowance: ${given.join(', ')}`,
    });
  }
  for (const w of sessions) {
    if (w.movedToStart) {
      notes.push({
        kind: 'midnight',
        message: `${w.date}: end held at ${settings.latestEndTime}, ${w.movedToStart / 60}h moved to the start (now ${formatTime(w.finalStart)})`,
      });
    }
  }

  const siRows: ClaimRow[] = sessions.map((w) => ({
    dates: [w.date],
    service: 'SI SESSION',
    timeIn: formatTime(w.finalStart),
    timeOut: formatTime(w.finalEnd),
    minutes: w.minutes,
  }));
  // Rule 7: SI sessions first in date order, then classes in date order.
  const allRows = [...siRows, ...classRows(input.classes, settings, notes)];

  const uncappedMinutes = allRows.reduce((sum, r) => sum + r.minutes, 0);
  const capMinutes = settings.monthlyCapHours * 60;
  const capped = uncappedMinutes > capMinutes;
  const totalMinutes = Math.min(uncappedMinutes, capMinutes);
  if (capped) {
    // AWAITING DECISION: which lines are reduced so the lines add up to the cap.
    notes.push({
      kind: 'cap',
      message: `${uncappedMinutes / 60}h worked, capped at ${settings.monthlyCapHours}h`,
    });
  }

  const rows = combineRows(allRows, settings.rowsPerPage, notes);
  return {
    sessions,
    rows,
    fitsOnForm: rows.length <= settings.rowsPerPage,
    dataAllowanceHours: allowance,
    uncappedMinutes,
    totalMinutes,
    capped,
    rateCents: input.rateCents,
    amountCents: amountCents(totalMinutes, input.rateCents),
    notes,
  };
}
