// Reads the SI Leaders' daily session register: a Word document with one
// table per week (Date | SI Leader | SI Module | Time | Platform |
// No. of students | Observer's Name). The date is written only on the first
// row of each day; the rows under it belong to the same day. A row's colour
// marks a cancelled session, no students, or not observed.
//
// Rule 1: the register is the source of truth for session times.
// Anything that can't be read with certainty is flagged, never guessed.

import type { Element } from '@xmldom/xmldom';
import type { RegisterColumns, Settings } from '../core/settings.ts';
import { parseTime } from '../core/time.ts';
import { W, children, descendants, openOffice, wordText } from './office.ts';

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

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** "Monday 06/10/2026" -> "2026-10-06"; null if there's no real date in it. */
export function readDate(text: string): string | null {
  const m = /(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4})/.exec(text);
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = month === 2 && leap ? 29 : DAYS_IN_MONTH[month - 1];
  if (!days || day < 1 || day > days) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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

type Positions = Record<keyof RegisterColumns, number>;

const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Column positions if this row is the heading row, else null. */
function headingPositions(texts: string[], columns: RegisterColumns): Positions | null {
  const pos: Partial<Positions> = {};
  for (const [key, heading] of Object.entries(columns) as [keyof RegisterColumns, string][]) {
    const i = texts.findIndex((t) => plain(t) === plain(heading));
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

/** Every session row in the register, in document order. Filter by month afterwards. */
export function readRegister(bytes: Uint8Array, settings: Settings): RegisterRow[] {
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

      const range = readTimeRange(time);
      const colours = [...new Set(cells.filter((_, i) => i !== pos!.date).flatMap(cellColours))];
      const known = colours.length === 1 ? colourList.find((c) => c.hex === colours[0]) : undefined;
      let colourProblem: string | null = null;
      if (colours.length > 1) colourProblem = `more than one colour (${colours.join(', ')})`;
      else if (colours.length === 1 && !known) colourProblem = `colour ${colours[0]} isn't in the settings`;

      // A row whose colour isn't claimed (e.g. cancelled) is left out whatever else it says.
      const leftOut = known !== undefined && !known.claimed;
      const problem = leftOut ? null : ((!name ? 'no SI Leader name' : null) ?? dateProblem ?? range.problem ?? colourProblem);
      rows.push({
        where: `table ${t + 1}, row ${r + 1}`,
        date,
        name,
        module,
        time,
        start: range.start,
        end: range.end,
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
