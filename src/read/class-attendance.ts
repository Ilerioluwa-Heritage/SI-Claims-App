// Reads one SI Leader's class attendance export (Excel, from Google Sheets).
// Both the SI Leader and the lecturer answer the same form; "I am:" says who.
// Classes come only from the lecturer's rows (SI Administrator, 2 Nov 2026):
// their date of lecture, module and lecture time. The SI Leader's rows are
// read only for their name, to know whose file this is. Nothing else is read:
// never the email, student number or lecturer's name.

import { normaliseName } from '../core/names.ts';
import type { ClassColumns, Settings } from '../core/settings.ts';
import { parseTime } from '../core/time.ts';
import type { LecturerClass } from '../run/month.ts';
import { readSheet, type Cell } from './office.ts';
import { excelDate, excelTime, plainHeading, readDate } from './values.ts';

export interface ClassFile {
  fileName: string;
  /** Whose classes these are; null if the file doesn't say clearly (flagged). */
  name: string | null;
  /** Where the name came from: the SI Leader's own rows, or the file's name. */
  nameFrom: 'form' | 'file name' | null;
  classes: LecturerClass[];
  problems: string[];
}

const hasNumber = (c?: Cell): c is Cell & { number: number } => c?.number != null && Number.isFinite(c.number);

/** "Mampa P October Class Attendance (Responses).xlsx" -> "Mampa P". */
function nameFromFileName(fileName: string): string {
  return fileName.replace(/\.xlsx$/i, '').split(/\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|class|\()/i)[0]!.trim();
}

export function readClassAttendance(bytes: Uint8Array, fileName: string, settings: Settings): ClassFile {
  const columns = settings.classColumns;
  const wanted = new Set(Object.values(columns).map(plainHeading));
  const sheet = readSheet(bytes, (h) => wanted.has(plainHeading(h)));
  const headingFor = (key: keyof ClassColumns) => sheet.headings.find((h) => plainHeading(h) === plainHeading(columns[key]));
  const missing = (Object.keys(columns) as (keyof ClassColumns)[]).filter((k) => headingFor(k) === undefined);
  if (missing.length) {
    throw new Error(`${fileName} has no column called ${missing.map((k) => `"${columns[k]}"`).join(' or ')}. Check the class attendance column names in the settings.`);
  }

  const problems: string[] = [];
  const names = new Set<string>();
  const lecturerRows: { row: number; get: (k: keyof ClassColumns) => Cell | undefined }[] = [];
  for (const { row, cells } of sheet.rows) {
    const get = (k: keyof ClassColumns) => cells.get(headingFor(k)!);
    const role = get('role')?.text.trim() ?? '';
    if (!role) continue;
    if (plainHeading(role) === plainHeading(settings.lecturerAnswer)) lecturerRows.push({ row, get });
    else if (get('name')?.text.trim()) names.add(normaliseName(get('name')!.text));
  }

  let name: string | null = null;
  let nameFrom: ClassFile['nameFrom'] = null;
  if (names.size === 1) {
    name = [...names][0]!;
    nameFrom = 'form';
  } else if (names.size > 1) {
    problems.push(`${fileName}: the SI Leader's name is written in different ways (${[...names].join(', ')}), so these classes aren't claimed until it's clear whose they are.`);
  } else if (nameFromFileName(fileName)) {
    name = normaliseName(nameFromFileName(fileName));
    nameFrom = 'file name';
  } else {
    problems.push(`${fileName}: there's no SI Leader's name in it, so these classes aren't claimed until it's clear whose they are.`);
  }

  const classes: LecturerClass[] = [];
  for (const { row, get } of lecturerRows) {
    const where = `${fileName}, row ${row}`;
    const dateCell = get('date');
    const date = hasNumber(dateCell) ? excelDate(dateCell.number) : (readDate(dateCell?.text ?? '') ?? '');
    const startCell = get('start');
    const start = hasNumber(startCell) ? excelTime(startCell.number) : parseTime(startCell?.text ?? '');
    const module = get('module')?.text.trim() ?? '';
    if (!date || start === null) {
      problems.push(`${where}: the lecturer's ${!date ? 'date of lecture' : 'lecture time'} can't be read, so this class isn't claimed.`);
      continue;
    }
    if (name) classes.push({ where, name, date, module, start });
  }
  return { fileName, name, nameFrom, classes, problems };
}
