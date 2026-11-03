// Reads the list of SI Leaders and their levels (a Word document with one
// table), which is uploaded once and kept. Only three columns are read: the
// name, the student number and the level of study (settings.levelsListColumns).
// Every other column, such as "Contact" (phone numbers), is never read, so
// only these three are ever kept.

import type { Element } from '@xmldom/xmldom';
import { normaliseName, splitName, type RosterPerson } from '../core/names.ts';
import type { LevelsListColumns, Settings } from '../core/settings.ts';
import { W, children, openOffice, rowCells, wordText } from './office.ts';
import { plainHeading } from './values.ts';

export interface LevelsList {
  /** The SI Leaders, as the month is matched against them. */
  people: RosterPerson[];
  /** Rows that couldn't be used, for the checks report. */
  problems: string[];
}

type Positions = Record<keyof LevelsListColumns, number>;

/** Column positions if this row is the heading row, else null. */
function headingPositions(tr: Element, columns: LevelsListColumns): Positions | null {
  const texts = rowCells(tr).map(wordText);
  const pos: Partial<Positions> = {};
  for (const [key, heading] of Object.entries(columns) as [keyof LevelsListColumns, string][]) {
    const i = texts.findIndex((t) => plainHeading(t) === plainHeading(heading));
    if (i < 0) return null;
    pos[key] = i;
  }
  return pos as Positions;
}

export function readLevelsList(bytes: Uint8Array, settings: Settings): LevelsList {
  const doc = openOffice(bytes, ['word/document.xml']).get('word/document.xml');
  if (!doc) throw new Error('This Word file has no document inside it.');
  const columns = settings.levelsListColumns;
  const people: RosterPerson[] = [];
  const problems: string[] = [];
  let found = false;

  for (const table of Array.from(doc.getElementsByTagNameNS(W, 'tbl'))) {
    const trs = children(table, 'tr');
    const headingRow = trs.findIndex((tr) => headingPositions(tr, columns));
    if (headingRow < 0) continue;
    found = true;
    const pos = headingPositions(trs[headingRow]!, columns)!;
    trs.slice(headingRow + 1).forEach((tr, i) => {
      const cells = rowCells(tr);
      // Only the three columns on the list are read from each row.
      const get = (key: keyof LevelsListColumns) => (cells[pos[key]] ? wordText(cells[pos[key]]!) : '');
      const [name, studentNumber, level] = [get('name'), get('studentNumber'), get('level')];
      if (!name && !studentNumber && !level) return;
      const where = `row ${headingRow + i + 2}`;
      const { surname, initials } = splitName(name);
      if (!surname) {
        problems.push(`${where}: "${name || '(no name)'}" has no surname the app can tell apart from the initials, so it isn't on the list.`);
        return;
      }
      people.push({ surname, initials, formName: normaliseName(`${surname} ${initials}`), level, active: true, role: 'SIL', aliases: [], studentNumber });
    });
  }
  if (!found) {
    const names = Object.values(columns).map((c) => `"${c}"`).join(', ');
    throw new Error(`The list has no table with the columns ${names}. Check the list's column names in the settings.`);
  }
  return { people, problems };
}
