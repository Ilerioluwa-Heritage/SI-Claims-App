// The claim form editor (SI Administrator, 3 Nov 2026): change any HRM-05's
// lines with typed commands, then work the totals out again. Adding a session
// applies the generator's rules: rounding, the 2h preparation and the 23H30
// limit. A change in the data allowance band is pointed out with the command
// that fixes it, never guessed at.

import { parseCommand, type Command, type Target } from './commands.ts';
import { MONTH_NAMES, isoDate, monthNumber } from './dates.ts';
import { amountCents, formatHours, formatRand, parseRand } from './money.ts';
import { combineRows, dataAllowanceHours, formatDates, splitIntoForms, workSession, type ClaimRow, type Note, type Service } from './rules.ts';
import type { Settings } from './settings.ts';
import { formatTime, parseTime } from './time.ts';

export interface EditableClaim {
  /** The claim's month (1-12) and year; null until known, e.g. on a blank form. */
  month: number | null;
  year: number | null;
  rateCents: number | null;
  /** The lines, in form order. */
  rows: ClaimRow[];
}

export interface Recalculated {
  /** Lines in form order: SI sessions then classes, by date; combined if more than fit. */
  rows: ClaimRow[];
  /** The lines for each form (one, or two when combining isn't enough); empty if they don't fit, which the warnings say. */
  forms: ClaimRow[][];
  uncappedMinutes: number;
  /** After the monthly cap. */
  totalMinutes: number;
  capped: boolean;
  /** Null until there's a rate. */
  amountCents: number | null;
  /** Things to look at: lines that don't add up, dates outside the month, no rate... */
  warnings: string[];
}

export interface EditResult {
  claim: EditableClaim;
  /** What was done, in a sentence, to show before it's accepted. */
  summary: string;
  /** Anything the administrator should know, e.g. a data allowance band change. */
  notes: string[];
}

/** Hours for display; lines from submitted forms may not be on the quarter hour. */
export const showHours = (minutes: number) => (minutes % 15 === 0 ? formatHours(minutes) : (minutes / 60).toFixed(2));

const timesOf = (r: ClaimRow) => r.timeIn.split('/').map((t, i) => ({ in: t, out: r.timeOut.split('/')[i] ?? '' }));
const minutesOf = (t: string, isEnd: boolean) => {
  const m = parseTime(t);
  return m === 0 && isEnd ? 24 * 60 : m;
};
const monthLabel = (c: { month: number | null; year: number | null }) => (c.month && c.year ? `${MONTH_NAMES[c.month - 1]} ${c.year}` : 'the month');
const inMonth = (c: EditableClaim, date: string) => !c.month || !c.year || date.startsWith(`${c.year}-${String(c.month).padStart(2, '0')}`);
const siSessions = (rows: ClaimRow[]) => rows.filter((r) => r.service === 'SI SESSION').reduce((n, r) => n + Math.max(1, r.dates.length), 0);

/** Classes on the same day share one line ("07H40/14H10"), as rule 6 says. */
function mergeClasses(rows: ClaimRow[]): ClaimRow[] {
  const out: ClaimRow[] = [];
  const byDate = new Map<string, ClaimRow>();
  for (const r of rows) {
    const date = r.dates[0];
    if (r.service !== 'CLASS ATTENDANCE' || r.dates.length !== 1 || !date) {
      out.push(r);
      continue;
    }
    const same = byDate.get(date);
    if (!same) {
      const copy = { ...r, dates: [date] };
      byDate.set(date, copy);
      out.push(copy);
      continue;
    }
    const parts = [...timesOf(same), ...timesOf(r)].sort((a, b) => (parseTime(a.in) ?? 0) - (parseTime(b.in) ?? 0));
    same.timeIn = parts.map((p) => p.in).join('/');
    same.timeOut = parts.map((p) => p.out).join('/');
    same.minutes += r.minutes;
  }
  return out;
}

/** Rule 7: SI sessions first, then classes, each by date (then start time). */
const formOrder = (rows: ClaimRow[]) =>
  [...rows].sort((a, b) => {
    const key = (r: ClaimRow) => `${r.service === 'SI SESSION' ? 0 : 1}${r.dates[0] ?? '9999'}${r.timeIn}`;
    return key(a).localeCompare(key(b));
  });

/** Puts the lines in form order and works out the totals and amount again. */
export function recalculate(claim: EditableClaim, settings: Settings): Recalculated {
  const notes: Note[] = [];
  const rows = combineRows(formOrder(mergeClasses(claim.rows)), settings, notes);
  const forms = splitIntoForms(rows, settings, notes);
  const warnings = notes.map((n) => n.message);

  rows.forEach((r, i) => {
    const n = `Line ${i + 1}`;
    if (!r.dates.length) warnings.push(`${n}: the date can't be read. Fix it with "move line ${i + 1} to the ...".`);
    else if (r.dates.some((d) => !inMonth(claim, d))) warnings.push(`${n}: ${formatDates(r.dates)} isn't in ${monthLabel(claim)}.`);
    const parts = timesOf(r).map((p) => ({ in: minutesOf(p.in, false), out: minutesOf(p.out, true) }));
    if (parts.some((p) => p.in === null || p.out === null)) {
      warnings.push(`${n}: the times ${r.timeIn}-${r.timeOut} can't be read.`);
      return;
    }
    const worked = parts.reduce((s, p) => s + p.out! - p.in!, 0) * Math.max(1, r.dates.length);
    const onDates = r.dates.length > 1 ? ` on ${r.dates.length} dates` : '';
    if (worked !== r.minutes) warnings.push(`${n}: ${r.timeIn}-${r.timeOut}${onDates} is ${showHours(worked)}h, but ${showHours(r.minutes)}h is claimed.`);
  });

  const uncappedMinutes = rows.reduce((s, r) => s + r.minutes, 0);
  const capMinutes = settings.monthlyCapHours * 60;
  const capped = uncappedMinutes > capMinutes;
  const totalMinutes = Math.min(uncappedMinutes, capMinutes);
  if (capped) warnings.push(`${showHours(uncappedMinutes)}h is over the ${settings.monthlyCapHours}h cap, so the amount is worked out on ${settings.monthlyCapHours}h.`);
  if (claim.rateCents === null) warnings.push('There is no rate yet. Say "set the rate to R36.50" or "set the level to Honours".');
  if (!claim.month || !claim.year) warnings.push('There is no month yet. Say "the month is October 2026".');

  return {
    rows,
    forms,
    uncappedMinutes,
    totalMinutes,
    capped,
    amountCents: claim.rateCents === null ? null : amountCents(totalMinutes, claim.rateCents),
    warnings,
  };
}

/** A band change (e.g. 4 -> 5 sessions: 2h -> 3h data allowance) is pointed out, not applied. */
function bandNote(before: number, after: number, settings: Settings): string | null {
  const was = dataAllowanceHours(before, settings.dataAllowanceBands);
  const now = dataAllowanceHours(after, settings.dataAllowanceBands);
  if (was === now) return null;
  const fix =
    now > was
      ? `To add it: "add ${now - was} hour${now - was > 1 ? 's' : ''} to the session of the ...".`
      : `To take it off: "remove ${was - now} hour${was - now > 1 ? 's' : ''} from the session of the ...".`;
  return (
    `The form now has ${after} SI session${after === 1 ? '' : 's'}, which earn${after === 1 ? 's' : ''} ${now}h data allowance instead of ${was}h. ` +
    `That isn't changed automatically. ${fix} By the rules, data hours go one each to the month's first sessions by date.`
  );
}

type Found = { index: number; date: string | null };

/** The one line a target points at, or a plain question if it's not clear which. */
function findLine(rows: ClaimRow[], target: Target): Found | { error: string } {
  if ('line' in target) {
    const r = rows[target.line - 1];
    if (!r) return { error: `There's no line ${target.line}; the form has ${rows.length} line${rows.length === 1 ? '' : 's'}.` };
    return { index: target.line - 1, date: r.dates.length === 1 ? r.dates[0]! : null };
  }
  const kind = target.service === 'SI SESSION' ? 'SI session' : 'class';
  const onDate = (d: string) => rows.flatMap((r, i) => (r.service === target.service && r.dates.includes(d) ? [{ r, i }] : []));
  let date = target.date;
  let matches = onDate(date);
  if (!matches.length && target.dayOnly) {
    // e.g. a line dated 06/11 on an October form: "the 6th" still finds it if it's the only one.
    const day = date.slice(8);
    const others = [...new Set(rows.filter((r) => r.service === target.service).flatMap((r) => r.dates).filter((d) => d.slice(8) === day))];
    if (others.length === 1) {
      date = others[0]!;
      matches = onDate(date);
    }
  }
  if (target.at !== null) matches = matches.filter(({ r }) => r.timeIn.split('/').some((t) => parseTime(t) === target.at));
  const at = target.at !== null ? ` starting at ${formatTime(target.at)}` : '';
  if (!matches.length) return { error: `There's no ${kind} on ${formatDates([date])}${at}.` };
  if (matches.length > 1) {
    const list = matches.map(({ r, i }) => `line ${i + 1} (${r.timeIn}-${r.timeOut})`).join(' and ');
    const second = matches[1]!;
    return { error: `There are ${matches.length} ${kind}s on ${formatDates([date])}: ${list}. Say which, e.g. "line ${second.i + 1}" or "at ${second.r.timeIn}".` };
  }
  return { index: matches[0]!.i, date };
}

/** Takes one date out of a combined line ("07&08/10/2026") into a line of its own. */
function splitOffDate(rows: ClaimRow[], index: number, date: string): number | { error: string } {
  const r = rows[index]!;
  if (r.dates.length === 1) return index;
  const each = r.minutes / r.dates.length;
  if (!Number.isInteger(each)) return { error: `Line ${index + 1}'s hours don't split evenly between its dates; change the whole line instead.` };
  rows[index] = { ...r, dates: r.dates.filter((d) => d !== date), minutes: r.minutes - each };
  rows.push({ ...r, dates: [date], minutes: each });
  return rows.length - 1;
}

/** Takes one class out of a shared class line ("07H40/14H10") into a line of its own. */
function splitOffClass(rows: ClaimRow[], index: number, at: number | null): number | { error: string } {
  const r = rows[index]!;
  const parts = timesOf(r);
  if (parts.length === 1) return index;
  if (at === null) {
    return { error: `There are ${parts.length} classes on ${formatDates(r.dates)} (${r.timeIn}). Say which, e.g. "at ${parts[1]!.in}".` };
  }
  const k = parts.findIndex((p) => parseTime(p.in) === at);
  const each = r.minutes / parts.length;
  const rest = parts.filter((_, i) => i !== k);
  rows[index] = { ...r, timeIn: rest.map((p) => p.in).join('/'), timeOut: rest.map((p) => p.out).join('/'), minutes: r.minutes - each };
  rows.push({ ...r, timeIn: parts[k]!.in, timeOut: parts[k]!.out, minutes: each });
  return rows.length - 1;
}

const describe = (r: ClaimRow) => `${r.service === 'SI SESSION' ? 'SI session' : 'class'} on ${formatDates(r.dates)} (${r.timeIn}-${r.timeOut}, ${showHours(r.minutes)}h)`;

/** Applies one command. The claim passed in is never changed; a new one comes back. */
export function applyCommand(claim: EditableClaim, cmd: Command, settings: Settings): EditResult | { error: string } {
  const rows = recalculate(claim, settings).rows.map((r) => ({ ...r, dates: [...r.dates] }));
  const notes: string[] = [];
  const done = (summary: string, changes: Partial<EditableClaim> = {}): EditResult => {
    const next = { ...claim, ...changes, rows };
    return { claim: { ...next, rows: recalculate(next, settings).rows }, summary, notes };
  };
  const notInMonth = (date: string) => ({ error: `${formatDates([date])} isn't in ${monthLabel(claim)}.` });

  switch (cmd.kind) {
    case 'add-session': {
      if (!inMonth(claim, cmd.date)) return notInMonth(cmd.date);
      let w;
      try {
        w = workSession({ date: cmd.date, start: cmd.start, end: cmd.end }, 0, settings);
      } catch (e) {
        return { error: (e as Error).message };
      }
      const row: ClaimRow = { dates: [cmd.date], service: 'SI SESSION', timeIn: formatTime(w.finalStart), timeOut: formatTime(w.finalEnd), minutes: w.minutes };
      const sameDay = rows.filter((r) => r.service === 'SI SESSION' && r.dates.includes(cmd.date));
      if (sameDay.some((r) => r.timeIn === row.timeIn && r.timeOut === row.timeOut)) {
        return { error: `There's already an SI session ${row.timeIn}-${row.timeOut} on ${formatDates([cmd.date])}.` };
      }
      const overlapping = sameDay.filter((r) => {
        const s = minutesOf(r.timeIn, false);
        const e = minutesOf(r.timeOut, true);
        return s !== null && e !== null && s < w.finalEnd && w.finalStart < e;
      });
      if (overlapping.length) notes.push(`It overlaps ${overlapping.map((r) => `${r.timeIn}-${r.timeOut}`).join(', ')} on the same day. Check it isn't the same session.`);
      const band = bandNote(siSessions(rows), siSessions(rows) + 1, settings);
      if (band) notes.push(band);
      rows.push(row);
      const moved = w.movedToStart ? `, with ${formatHours(w.movedToStart)}h moved onto the start to finish by ${settings.latestEndTime}` : '';
      return done(
        `Add an SI session on ${formatDates([cmd.date])}: ${formatTime(cmd.start)}-${formatTime(cmd.end)} rounds to ` +
          `${formatTime(w.roundedStart)}-${formatTime(w.roundedEnd === 24 * 60 ? 0 : w.roundedEnd)}, plus ${settings.prepHoursPerSession}h preparation${moved}: ` +
          `${row.timeIn}-${row.timeOut}, ${formatHours(row.minutes)}h.`,
      );
    }

    case 'add-class': {
      if (!inMonth(claim, cmd.date)) return notInMonth(cmd.date);
      const classMinutes = settings.classHours * 60;
      if (cmd.start + classMinutes >= 24 * 60) return { error: 'A class must finish before midnight.' };
      const timeIn = formatTime(cmd.start);
      if (rows.some((r) => r.service === 'CLASS ATTENDANCE' && r.dates.includes(cmd.date) && r.timeIn.split('/').includes(timeIn))) {
        return { error: `There's already a class at ${timeIn} on ${formatDates([cmd.date])}.` };
      }
      const row: ClaimRow = { dates: [cmd.date], service: 'CLASS ATTENDANCE', timeIn, timeOut: formatTime(cmd.start + classMinutes), minutes: classMinutes };
      rows.push(row);
      return done(`Add a class on ${formatDates([cmd.date])}: ${row.timeIn}-${row.timeOut}, ${settings.classHours}h from the lecture start.`);
    }

    case 'remove': {
      const found = findLine(rows, cmd.target);
      if ('error' in found) return found;
      const before = siSessions(rows);
      let index = found.index;
      const r = rows[index]!;
      if (r.service === 'CLASS ATTENDANCE' && !('line' in cmd.target)) {
        const split = splitOffClass(rows, index, cmd.target.at);
        if (typeof split !== 'number') return split;
        index = split;
      }
      if (rows[index]!.dates.length > 1 && found.date) {
        const split = splitOffDate(rows, index, found.date);
        if (typeof split !== 'number') return split;
        index = split;
      }
      const [removed] = rows.splice(index, 1);
      const band = removed!.service === 'SI SESSION' ? bandNote(before, siSessions(rows), settings) : null;
      if (band) notes.push(band);
      return done(`Remove the ${describe(removed!)}.`);
    }

    case 'change-hours': {
      if (cmd.minutes % 30 !== 0) return { error: 'Hours go on the form in half hours: use 30 minutes, 1 hour, 1.5 hours and so on.' };
      const found = findLine(rows, cmd.target);
      if ('error' in found) return found;
      let index = found.index;
      const r = rows[index]!;
      if (r.service !== 'SI SESSION') return { error: `A class is always worth ${settings.classHours}h. Remove it, or add a session instead.` };
      if (r.timeIn.includes('/')) return { error: `Line ${index + 1} has more than one time on it; it can't be lengthened.` };
      if (r.dates.length > 1) {
        if (!found.date) return { error: `Line ${index + 1} covers ${formatDates(r.dates)}. Say which day, e.g. "the session of the ...".` };
        const split = splitOffDate(rows, index, found.date);
        if (typeof split !== 'number') return split;
        index = split;
      }
      const line = rows[index]!;
      const start = minutesOf(line.timeIn, false);
      const end = minutesOf(line.timeOut, true);
      const latest = parseTime(settings.latestEndTime);
      if (start === null || end === null || latest === null) return { error: `The times on that line (${line.timeIn}-${line.timeOut}) can't be read.` };
      let newStart = start;
      let newEnd = end + cmd.minutes;
      if (newEnd > latest) {
        newStart -= newEnd - latest;
        newEnd = latest;
      }
      if (newStart < 0) return { error: "That won't fit in one day." };
      if (newEnd <= newStart || line.minutes + cmd.minutes <= 0) return { error: 'That would leave no time on the line. Remove the session instead.' };
      const was = describe(line);
      rows[index] = { ...line, timeIn: formatTime(newStart), timeOut: formatTime(newEnd), minutes: line.minutes + cmd.minutes };
      const held = newStart !== start ? ` (held at ${settings.latestEndTime}; the rest moved onto the start)` : '';
      return done(`Change the ${was} to ${rows[index]!.timeIn}-${rows[index]!.timeOut}, ${showHours(rows[index]!.minutes)}h${held}.`);
    }

    case 'move': {
      if (!inMonth(claim, cmd.to)) return notInMonth(cmd.to);
      const found = findLine(rows, cmd.target);
      if ('error' in found) return found;
      let index = found.index;
      if (rows[index]!.service === 'CLASS ATTENDANCE' && !('line' in cmd.target)) {
        const split = splitOffClass(rows, index, cmd.target.at);
        if (typeof split !== 'number') return split;
        index = split;
      }
      if (rows[index]!.dates.length > 1) {
        if (!found.date) return { error: `Line ${index + 1} covers ${formatDates(rows[index]!.dates)}. Say which day to move.` };
        const split = splitOffDate(rows, index, found.date);
        if (typeof split !== 'number') return split;
        index = split;
      }
      const was = describe(rows[index]!);
      rows[index] = { ...rows[index]!, dates: [cmd.to] };
      return done(`Move the ${was} to ${formatDates([cmd.to])}.`);
    }

    case 'set-rate': {
      const rateCents = cmd.rateCents ?? parseRand(settings.rates[cmd.level!]);
      return done(`Set the rate to ${formatRand(rateCents)}${cmd.level ? ` (${cmd.level})` : ''}.`, { rateCents });
    }

    case 'set-month': {
      return done(`The form is for ${MONTH_NAMES[cmd.month - 1]} ${cmd.year}.`, { month: cmd.month, year: cmd.year });
    }
  }
}

/** Reads a typed command and applies it. */
export function editClaim(claim: EditableClaim, text: string, settings: Settings): EditResult | { error: string } {
  const cmd = parseCommand(text, claim);
  return 'error' in cmd ? cmd : applyCommand(claim, cmd, settings);
}

// ---------------------------------------------------------------------------
// Starting from a form's own text (what's typed in its boxes)
// ---------------------------------------------------------------------------

/** "07&08/10/2026" -> ["2026-10-07", "2026-10-08"]; also "30/09/2026&01/10/2026". Null if unreadable. */
export function parseFormDates(text: string): string[] | null {
  const t = text.replace(/\s+/g, '');
  const shared = /^(\d{1,2}(?:&\d{1,2})*)[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  const dates = shared
    ? shared[1]!.split('&').map((d) => isoDate(Number(d), Number(shared[2]), Number(shared[3])))
    : t.split('&').map((p) => {
        const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(p);
        return m ? isoDate(Number(m[1]), Number(m[2]), Number(m[3])) : null;
      });
  return t && dates.every((d) => d !== null) ? (dates as string[]) : null;
}

export interface FormText {
  month: string;
  year: string;
  rate: string;
  lines: { date: string; service: string; timeIn: string; timeOut: string; hours: string }[];
}

/** An editable claim from the text in a form's boxes. Anything unreadable is listed, not guessed. */
export function claimFromForm(form: FormText): { claim: EditableClaim; problems: string[] } {
  const problems: string[] = [];
  let rateCents: number | null = null;
  if (form.rate.trim()) {
    try {
      rateCents = parseRand(form.rate);
    } catch {
      problems.push(`The rate "${form.rate}" can't be read.`);
    }
  }
  const year = /^\d{4}$/.test(form.year.trim()) ? Number(form.year.trim()) : null;
  const month = form.month.trim() ? monthNumber(form.month) : null;
  if (form.month.trim() && month === null) problems.push(`The month "${form.month}" can't be read.`);

  const rows: ClaimRow[] = form.lines.map((l, i) => {
    const n = `Line ${i + 1}`;
    const dates = parseFormDates(l.date);
    if (!dates) problems.push(`${n}: the date "${l.date}" can't be read.`);
    const s = l.service.trim().toUpperCase();
    const service: Service = s.startsWith('CLASS') ? 'CLASS ATTENDANCE' : 'SI SESSION';
    if (s !== 'SI SESSION' && s !== 'CLASS ATTENDANCE') problems.push(`${n}: the service "${l.service}" isn't SI SESSION or CLASS ATTENDANCE; read as ${service}.`);
    const hours = /^\d+([.,]\d+)?$/.test(l.hours.trim()) ? Math.round(Number(l.hours.trim().replace(',', '.')) * 60) : null;
    if (hours === null) problems.push(`${n}: the hours "${l.hours}" can't be read.`);
    return { dates: dates ?? [], service, timeIn: l.timeIn.trim().toUpperCase(), timeOut: l.timeOut.trim().toUpperCase(), minutes: hours ?? 0 };
  });
  return { claim: { month, year, rateCents, rows }, problems };
}
