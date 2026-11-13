// The claim rules (numbered as in the brief). Pure functions only: no files,
// no network, no dates from the clock. The website, the phone app and the
// tests all call these same functions, so they cannot disagree.

import { amountCents } from './money.ts';
import type { AllowanceBand, Settings } from './settings.ts';
import { formatTime, latestEndMinutes, roundEnd, roundStart } from './time.ts';

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

/** What rule 8 took off to bring the month down to the cap. */
export interface CapWorking {
  /** Classes taken off, latest first. */
  removedClasses: ClassRecord[];
  /** Data allowance minutes taken off, per session date, latest first. */
  dataCut: { date: string; minutes: number }[];
  /** Minutes still over the cap after that (needs the administrator's decision; no form is filled). */
  stillOver: number;
}

export interface ClaimResult {
  sessions: SessionWorking[];
  /** Set when the month was over the cap (rule 8). */
  cap: CapWorking | null;
  /** Lines in form order (SI sessions, then classes), combined if they didn't fit. */
  rows: ClaimRow[];
  /**
   * The lines for each form: one form, or two when combining wasn't enough.
   * Empty if even that can't hold them (flagged; no form is filled).
   */
  forms: ClaimRow[][];
  dataAllowanceHours: number;
  /** Sum of all lines before the monthly cap. */
  uncappedMinutes: number;
  /** Hours actually claimed, after the cap: the lines add up to this. */
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
  const latestEnd = latestEndMinutes(settings.latestEndTime);

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

/** The classes in date order, each counted once (a class recorded twice is noted). */
export function uniqueClasses(classes: ClassRecord[], notes: Note[]): ClassRecord[] {
  const out: ClassRecord[] = [];
  const seen = new Set<string>();
  for (const c of [...classes].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)) {
    // Same module, same day, starts in the same half hour: one class recorded twice.
    const key = `${c.date}|${roundStart(c.start)}|${c.module.toUpperCase().replace(/[^A-Z0-9]/g, '')}`;
    if (seen.has(key)) {
      notes.push({ kind: 'duplicate-class', message: `${c.module} on ${c.date} was recorded twice; counted once` });
      continue;
    }
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * Each class the lecturer recorded is worth `classHours`, from the actual
 * lecture start (not rounded): 11H10 in, 13H10 out. Classes on the same day
 * share one line: "07H40/14H10" in, "09H40/16H10" out, hours added together.
 */
export function classRows(classes: ClassRecord[], settings: Settings, notes: Note[]): ClaimRow[] {
  const classMinutes = settings.classHours * 60;
  const byDate = new Map<string, number[]>();
  for (const c of uniqueClasses(classes, notes)) byDate.set(c.date, [...(byDate.get(c.date) ?? []), c.start]);
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
 * Rule 11 (SI Administrator, 13 Nov 2026). The form has 13 lines. If there are
 * more, class attendance lines with the same time in and time out are combined
 * first, at most 2 to a line; if that's still too many, SI session lines with
 * the same times are combined, at most 2 to a line. Dates are joined with "&"
 * and hours added; a combined line sits where the first of its dates was.
 *
 * If even that doesn't fit on one form, nothing is combined at all: every
 * session and every class gets its own line, the first 13 on the first form
 * and the rest on the second (splitIntoForms). Lines that were already
 * combined (e.g. on a form read into the editor) are split back into one line
 * per date. Two classes on the same day still share their line (rule 6).
 */
export function combineRows(rows: ClaimRow[], settings: Settings, notes: Note[]): ClaimRow[] {
  if (rows.length <= settings.rowsPerPage) return rows;
  const tried: Note[] = [];
  let result = rows;
  const steps = [
    ['CLASS ATTENDANCE', settings.maxClassesPerLine],
    ['SI SESSION', settings.maxSessionsPerLine],
  ] as const;
  for (const [service, most] of steps) {
    if (result.length <= settings.rowsPerPage) break;
    result = combineService(result, service, most, tried);
  }
  if (result.length <= settings.rowsPerPage) {
    notes.push(...tried);
    return result;
  }
  const separate = rows.flatMap(oneLinePerDate);
  notes.push({
    kind: 'combined',
    message: `${result.length} lines even after combining, more than one form holds, so nothing is combined: ${separate.length} lines, one per session or class, over two forms`,
  });
  return separate;
}

/** A combined line ("07&08/10/2026") back as one line per date, when its hours split evenly. */
function oneLinePerDate(r: ClaimRow): ClaimRow[] {
  if (r.dates.length < 2 || r.minutes % r.dates.length !== 0) return [r];
  const each = r.minutes / r.dates.length;
  return r.dates.map((d) => ({ ...r, dates: [d], minutes: each }));
}

/** Lines of one service with the same time in and time out, combined at most `most` to a line, in date order. */
function combineService(rows: ClaimRow[], service: Service, most: number, notes: Note[]): ClaimRow[] {
  const open = new Map<string, ClaimRow>(); // per time in/out, the line still taking dates
  const combined = new Set<ClaimRow>();
  const out: ClaimRow[] = [];
  for (const r of rows) {
    if (r.service !== service) {
      out.push(r);
      continue;
    }
    const key = `${r.timeIn}|${r.timeOut}`;
    const line = open.get(key);
    if (line && line.dates.length + r.dates.length <= most) {
      line.dates = [...line.dates, ...r.dates];
      line.minutes += r.minutes;
      combined.add(line);
    } else {
      const copy = { ...r, dates: [...r.dates] };
      open.set(key, copy);
      out.push(copy);
    }
  }
  for (const line of combined) {
    notes.push({ kind: 'combined', message: `${line.service} ${line.timeIn}-${line.timeOut} on ${formatDates(line.dates)} combined into one line` });
  }
  return out;
}

/**
 * Only when combining isn't enough do the lines continue on a second form,
 * a complete copy of it (at most settings.maxForms), one line per session or
 * class (see combineRows). If even that can't hold
 * them, no form is filled and it's flagged for the administrator to decide
 * (for example in the claim form editor); no line is ever dropped.
 */
export function splitIntoForms(rows: ClaimRow[], settings: Settings, notes: Note[]): ClaimRow[][] {
  const forms: ClaimRow[][] = [];
  for (let i = 0; i < rows.length; i += settings.rowsPerPage) forms.push(rows.slice(i, i + settings.rowsPerPage));
  if (forms.length > settings.maxForms) {
    notes.push({
      kind: 'too-many-lines',
      message: `${rows.length} lines; ${settings.maxForms} forms hold ${settings.maxForms * settings.rowsPerPage}. This needs your decision before the forms can be filled.`,
    });
    return [];
  }
  return forms.length ? forms : [[]];
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

// ---------------------------------------------------------------------------
// Rule 8: the monthly cap (SI Administrator, 13 Nov 2026)
// ---------------------------------------------------------------------------

/**
 * Brings a month over the cap back down to it. Classes are taken off first,
 * latest first, while the month is still at least one class over. What's left
 * (e.g. 1h for an 81h month) comes off the data allowance hours, from the
 * latest session with data hours backwards. If the month is still over after
 * all of that, it's flagged and left for the administrator.
 * `sessions` and `classes` are in date order; neither is changed.
 */
export function applyCap(
  valid: SiSession[],
  sessions: SessionWorking[],
  classes: ClassRecord[],
  settings: Settings,
): { sessions: SessionWorking[]; classes: ClassRecord[]; cap: CapWorking } {
  const classMinutes = settings.classHours * 60;
  const capMinutes = settings.monthlyCapHours * 60;
  const total = (ss: SessionWorking[], cs: ClassRecord[]) => ss.reduce((n, w) => n + w.minutes, 0) + cs.length * classMinutes;

  const kept = [...classes];
  const removedClasses: ClassRecord[] = [];
  while (kept.length && total(sessions, kept) - capMinutes >= classMinutes) removedClasses.push(kept.pop()!);

  const worked = [...sessions];
  const dataCut: CapWorking['dataCut'] = [];
  // Less than one class over (e.g. 81h), or no classes left: take the rest off the data hours.
  let over = total(worked, kept) - capMinutes;
  for (let i = worked.length - 1; i >= 0 && over > 0; i--) {
    const w = worked[i]!;
    if (!w.dataMinutes) continue;
    const cut = Math.min(over, w.dataMinutes);
    worked[i] = workSession(valid[i]!, (w.dataMinutes - cut) / 60, settings);
    dataCut.push({ date: w.date, minutes: cut });
    over -= cut;
  }
  return { sessions: worked, classes: kept, cap: { removedClasses, dataCut, stillOver: Math.max(0, over) } };
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
  let sessions = valid.map((s, i) => workSession(s, spread[i]!, settings));
  if (allowance > 0) {
    const given = sessions.flatMap((w) => (w.dataMinutes ? [`${w.date} +${w.dataMinutes / 60}h`] : []));
    notes.push({
      kind: 'data-allowance',
      message: `${valid.length} sessions -> ${allowance}h data allowance: ${given.join(', ')}`,
    });
  }

  let classes = uniqueClasses(input.classes, notes);
  const classMinutes = settings.classHours * 60;
  const uncappedMinutes = sessions.reduce((n, w) => n + w.minutes, 0) + classes.length * classMinutes;
  const capMinutes = settings.monthlyCapHours * 60;
  const capped = uncappedMinutes > capMinutes;
  let cap: CapWorking | null = null;
  if (capped) {
    ({ sessions, classes, cap } = applyCap(valid, sessions, classes, settings));
    const parts = [
      cap.removedClasses.length
        ? `${cap.removedClasses.length} class${cap.removedClasses.length === 1 ? '' : 'es'} taken off (${[...cap.removedClasses].reverse().map((c) => `${c.module} ${formatDates([c.date])} ${formatTime(c.start)}`).join(', ')})`
        : '',
      cap.dataCut.length ? `${cap.dataCut.map((d) => `${d.minutes / 60}h data taken off ${formatDates([d.date])}`).join(', ')}` : '',
    ].filter(Boolean);
    notes.push({
      kind: 'cap',
      message: `${uncappedMinutes / 60}h worked, over the ${settings.monthlyCapHours}h cap: ${parts.join('; ') || 'nothing could be taken off'}` +
        (cap.stillOver ? `. Still ${cap.stillOver / 60}h over with no classes or data hours left to take off; this needs your decision before the form can be filled.` : ''),
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
  const allRows = [...siRows, ...classRows(classes, settings, [])];
  // The lines add up to the cap, unless it couldn't be reached (flagged above; no form is filled).
  const totalMinutes = Math.min(allRows.reduce((sum, r) => sum + r.minutes, 0), capMinutes);

  const rows = combineRows(allRows, settings, notes);
  const fitted = splitIntoForms(rows, settings, notes);
  const forms = cap?.stillOver ? [] : fitted;
  return {
    sessions,
    cap,
    rows,
    forms,
    dataAllowanceHours: allowance,
    uncappedMinutes,
    totalMinutes,
    capped,
    rateCents: input.rateCents,
    amountCents: amountCents(totalMinutes, input.rateCents),
    notes,
  };
}
