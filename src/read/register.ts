// Reads the SI Leaders' daily session register: a Word document with one
// table per week (Date | SI Leader | SI Module | Time | Platform |
// No. of students | Observer's Name). The date is written only on the first
// row of each day; the rows under it belong to the same day. A row's colour
// marks a cancelled session, no students, or not observed.
//
// Rule 1: the register is the source of truth for session times.
// Anything that can't be read with certainty is flagged, never guessed.

import type { Element } from '@xmldom/xmldom';
import { matchName, splitName } from '../core/names.ts';
import type { RegisterColumns, Settings } from '../core/settings.ts';
import { parseTime } from '../core/time.ts';
import type { DebriefRow } from './debrief.ts';
import { W, children, descendants, openOffice, wordText } from './office.ts';
import { plainHeading, readDate } from './values.ts';

export interface RegisterRow {
  /** Where the row is in the document, for the checks report: "table 64, row 3". */
  where: string;
  /** "YYYY-MM-DD", or "" if there's no readable date. */
  date: string;
  name: string;
  module: string;
  /** The time exactly as typed, e.g. "15h30-17h00". */
  time: string;
  start: number | null;
  end: number | null;
  /** Set when the register had no end time and it came from the debrief: "end time from the debrief (row 12)". */
  timeFrom: string | null;
  observer: string;
  /** Hex code of the row's colour ("FF0000"), or null if uncoloured. */
  colour: string | null;
  /** What the colour means, from the settings ("Session cancelled"). */
  meaning: string | null;
  /** Goes on the claim: readable, and uncoloured or in a colour that is claimed. */
  claimed: boolean;
  /** Why the row can't be used as it is. Such rows are never claimed. */
  problem: string | null;
}

/** "15h30-17h00" -> start and end in minutes. "15h30-" has a start but no end. */
export function readTimeRange(text: string): { start: number | null; end: number | null; problem: string | null } {
  const typed = text.trim();
  if (!typed) return { start: null, end: null, problem: 'no time' };
  const parts = typed.split(/\s*(?:-|–|—|\bto\b)\s*/i);
  const start = parseTime(parts[0] ?? '');
  const endText = (parts[1] ?? '').trim();
  if (parts.length > 2 || start === null) return { start: null, end: null, problem: `time "${typed}" unreadable` };
  if (!endText) return { start, end: null, problem: 'no end time' };
  const end = parseTime(endText);
  if (end === null) return { start, end: null, problem: `end time "${typed}" unreadable` };
  return { start, end, problem: null };
}

/** A debrief starting further than this from the register's start is a different session. */
export const SAME_SESSION_MINUTES = 30;

/**
 * Missing register times come from the debrief (SI Administrator, 2 Nov 2026).
 * A row with a start but no end takes the end of the same SI Leader's debrief
 * for that day that starts within 30 minutes of it. A row with no time at all
 * takes start and end from the SI Leader's only debrief that day. Anything
 * less certain stays flagged.
 */
function timeFromDebrief(
  name: string,
  date: string,
  start: number | null,
  debrief: DebriefRow[],
): { start: number; end: number; note: string } | { problem: string } {
  if (!debrief.length) return { problem: 'no debrief to take it from' };
  const person = { ...splitName(name), formName: name, level: '', active: true, role: 'SIL' as const, aliases: [] };
  const sameDay = debrief.filter((d) => d.date === date && matchName(d.name, [person]).matched);
  const candidates = start === null ? sameDay : sameDay.filter((d) => d.start !== null && Math.abs(d.start - start) <= SAME_SESSION_MINUTES);
  if (!candidates.length) {
    return { problem: sameDay.length ? `no debrief that day starts within ${SAME_SESSION_MINUTES} minutes of it` : 'no debrief for that day' };
  }
  if (candidates.length > 1) return { problem: `${candidates.length} debriefs that day could be this session` };
  const d = candidates[0]!;
  const from = start ?? d.start;
  if (from === null || d.end === null) return { problem: `the debrief (${d.where}) has no time either` };
  if (d.end <= from && d.end !== 0) return { problem: `the debrief's end time (${d.where}) isn't after the start` };
  return { start: from, end: d.end, note: `${start === null ? 'time' : 'end time'} from the debrief (${d.where})` };
}

type Positions = Record<keyof RegisterColumns, number>;

/** Column positions if this row is the heading row, else null. */
function headingPositions(texts: string[], columns: RegisterColumns): Positions | null {
  const pos: Partial<Positions> = {};
  for (const [key, heading] of Object.entries(columns) as [keyof RegisterColumns, string][]) {
    const i = texts.findIndex((t) => plainHeading(t) === plainHeading(heading));
    if (i < 0) return null;
    pos[key] = i;
  }
  return pos as Positions;
}

/** A row's cells by column; a cell merged across columns fills each of them. */
function rowCells(tr: Element): Element[] {
  const cells: Element[] = [];
  for (const tc of children(tr, 'tc')) {
    const span = children(children(tc, 'tcPr')[0] ?? tc, 'gridSpan')[0]?.getAttributeNS(W, 'val');
    for (let i = 0; i < Math.max(1, Number(span) || 1); i++) cells.push(tc);
  }
  return cells;
}

/** Shading and highlight colours used in a cell, upper case ("FF0000", "GREEN"). */
function cellColours(tc: Element): string[] {
  const shading = descendants(tc, 'shd').map((s) => s.getAttributeNS(W, 'fill') ?? '');
  const highlight = descendants(tc, 'highlight').map((h) => h.getAttributeNS(W, 'val') ?? '');
  return [...shading, ...highlight].map((c) => c.toUpperCase()).filter((c) => c && c !== 'AUTO' && c !== 'FFFFFF' && c !== 'NONE');
}

/**
 * Every session row in the register, in document order. Filter by month
 * afterwards. `debrief` fills in missing times; without it they stay flagged.
 */
export function readRegister(bytes: Uint8Array, settings: Settings, debrief: DebriefRow[] = []): RegisterRow[] {
  const doc = openOffice(bytes, ['word/document.xml']).get('word/document.xml');
  if (!doc) throw new Error('This Word file has no document inside it.');
  const colourList = Object.entries(settings.registerColours).map(([hex, c]) => ({ hex: hex.toUpperCase(), ...c }));

  const rows: RegisterRow[] = [];
  let pos: Positions | null = null;
  let width = 0;
  const tables = Array.from(doc.getElementsByTagNameNS(W, 'tbl'));
  for (let t = 0; t < tables.length; t++) {
    // The date carries down only within one week's table.
    let date = '';
    let dateProblem: string | null = 'no date above this row';
    const trs = children(tables[t]!, 'tr');
    for (let r = 0; r < trs.length; r++) {
      const cells = rowCells(trs[r]!);
      const texts = cells.map(wordText);
      const heading = headingPositions(texts, settings.registerColumns);
      if (heading) {
        pos = heading;
        width = cells.length;
        continue;
      }
      // Not a register row (e.g. the colour key), or before the first heading.
      if (!pos || cells.length !== width) continue;
      const get = (k: keyof RegisterColumns) => texts[pos![k]] ?? '';

      const dateText = get('date');
      if (dateText) {
        date = readDate(dateText) ?? '';
        dateProblem = date ? null : `date "${dateText}" unreadable`;
      }
      const [name, module, time] = [get('name'), get('module'), get('time')];
      if (!name && !module && !time) continue; // an empty line, e.g. a day with no sessions

      const colours = [...new Set(cells.filter((_, i) => i !== pos!.date).flatMap(cellColours))];
      const known = colours.length === 1 ? colourList.find((c) => c.hex === colours[0]) : undefined;
      let colourProblem: string | null = null;
      if (colours.length > 1) colourProblem = `more than one colour (${colours.join(', ')})`;
      else if (colours.length === 1 && !known) colourProblem = `colour ${colours[0]} isn't in the settings`;
      // A row whose colour isn't claimed (e.g. cancelled) is left out whatever else it says.
      const leftOut = known !== undefined && !known.claimed;

      let range = readTimeRange(time);
      let timeFrom: string | null = null;
      if (!leftOut && name && date && (range.problem === 'no end time' || range.problem === 'no time')) {
        const found = timeFromDebrief(name, date, range.start, debrief);
        if ('note' in found) {
          range = { start: found.start, end: found.end, problem: null };
          timeFrom = found.note;
        } else {
          range = { ...range, problem: `${range.problem}; ${found.problem}` };
        }
      }

      const problem = leftOut ? null : ((!name ? 'no SI Leader name' : null) ?? dateProblem ?? range.problem ?? colourProblem);
      rows.push({
        where: `table ${t + 1}, row ${r + 1}`,
        date,
        name,
        module,
        time,
        start: range.start,
        end: range.end,
        timeFrom,
        observer: get('observer'),
        colour: colours.length === 1 ? colours[0]! : null,
        meaning: known?.meaning ?? null,
        claimed: !problem && !leftOut,
        problem,
      });
    }
  }
  return rows;
}
