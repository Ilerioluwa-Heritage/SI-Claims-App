// Reads the debrief form export (Excel, downloaded from Google Sheets). Only
// the columns named in settings.debriefColumns are read: date, name, module,
// level, start and end time. Contact details and the other answers are never
// extracted.
//
// The debrief cross-checks the register, fills in a register row's missing
// times, and gives each SI Leader's level of study, which sets the rate.

import type { DebriefColumns, Level, Settings } from '../core/settings.ts';
import { parseTime } from '../core/time.ts';
import { readSheet, type Cell } from './office.ts';
import { excelDate, excelTime, plainHeading, readDate } from './values.ts';

export interface DebriefRow {
  /** Where the answer is in the spreadsheet, for the checks report: "row 12". */
  where: string;
  /** "YYYY-MM-DD", or "" if there's no readable date. */
  date: string;
  name: string;
  module: string;
  /** The level of study as answered, e.g. "Level 4 (Fourth Year)". */
  levelText: string;
  /** What that answer means for the rate; null if the answer isn't in the settings. */
  level: Level | null;
  start: number | null;
  end: number | null;
}

const hasNumber = (c?: Cell): c is Cell & { number: number } => c?.number != null && Number.isFinite(c.number);
const asDate = (c?: Cell) => (hasNumber(c) ? excelDate(c.number) : (readDate(c?.text ?? '') ?? ''));
const asTime = (c?: Cell) => (hasNumber(c) ? excelTime(c.number) : parseTime(c?.text ?? ''));

/** "Level 4 (Fourth Year)" -> "4th year", using settings.debriefLevels; null if unknown. */
export function levelOf(answer: string, settings: Settings): Level | null {
  const key = plainHeading(answer);
  if (!key) return null;
  return Object.entries(settings.debriefLevels).find(([a]) => plainHeading(a) === key)?.[1] ?? null;
}

export function readDebrief(bytes: Uint8Array, settings: Settings): DebriefRow[] {
  const columns = settings.debriefColumns;
  const wanted = new Set(Object.values(columns).map(plainHeading));
  const sheet = readSheet(bytes, (h) => wanted.has(plainHeading(h)));
  const headingFor = (key: keyof DebriefColumns) => sheet.headings.find((h) => plainHeading(h) === plainHeading(columns[key]));
  const missing = (Object.keys(columns) as (keyof DebriefColumns)[]).filter((k) => headingFor(k) === undefined);
  if (missing.length) {
    const names = missing.map((k) => `"${columns[k]}"`).join(' or ');
    throw new Error(`The debrief has no column called ${names}. Check the debrief column names in the settings.`);
  }

  return sheet.rows
    .map(({ row, cells }) => {
      const get = (key: keyof DebriefColumns) => cells.get(headingFor(key)!);
      const levelText = get('level')?.text.trim() ?? '';
      return {
        where: `row ${row}`,
        date: asDate(get('date')),
        name: get('name')?.text.trim() ?? '',
        module: get('module')?.text.trim() ?? '',
        levelText,
        level: levelOf(levelText, settings),
        start: asTime(get('start')),
        end: asTime(get('end')),
      };
    })
    .filter((r) => r.name || r.date);
}
