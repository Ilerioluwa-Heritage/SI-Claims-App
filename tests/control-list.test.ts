import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { CONTROL_LIST_HEADINGS, controlList } from '../src/out/control-list.ts';
import { readSheet } from '../src/read/office.ts';

const ROWS = [
  { surname: 'SAMPLE', initials: 'CD', studentNumber: '200000002', level: 'Honours', minutes: 8.5 * 60, rateCents: 4700 },
  { surname: "O'NEIL & SON", initials: 'AB', studentNumber: '200000001', level: '3rd year', minutes: 36.25 * 60, rateCents: 3650 },
  { surname: 'EXAMPLE', initials: 'AB', studentNumber: '', level: '', minutes: 120, rateCents: null },
];

describe('the control list (Excel)', () => {
  const bytes = controlList(ROWS);
  const sheet = readSheet(bytes, () => true);
  const cell = (row: number, heading: string) => sheet.rows[row]!.cells.get(heading)?.text ?? '';

  it('has the columns from the brief, in order', () => {
    expect(sheet.headings).toEqual([...CONTROL_LIST_HEADINGS]);
  });

  it('is alphabetical by surname, numbered, with hours, rate and level', () => {
    expect(sheet.rows.map((_, i) => ['#', 'SURNAME', 'INITIALS', 'LEVEL OF STUDY', 'HOURS WORKED', 'RATE/HOUR'].map((h) => cell(i, h)).join(' | '))).toEqual([
      '1 | EXAMPLE | AB |  | 2 | ',
      "2 | O'NEIL & SON | AB | 3rd year | 36.25 | 36.5",
      '3 | SAMPLE | CD | Honours | 8.5 | 47',
    ]);
  });

  it('works out TOTAL AMOUNT with a live formula, =F2*G2', () => {
    const xml = strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml']!);
    expect([...xml.matchAll(/<c r="(H\d+)"[^>]*><f>([^<]+)<\/f>/g)].map((m) => `${m[1]}=${m[2]}`)).toEqual(['H2=F2*G2', 'H3=F3*G3', 'H4=F4*G4']);
    // What a viewer shows before Excel recalculates: 36.25 x 36.50 = 1323.125, displayed as R1,323.13.
    expect(cell(1, 'TOTAL AMOUNT')).toBe('1323.125');
  });

  it('takes STUDENT NO: from the levels list, blank where the list has none', () => {
    expect(sheet.rows.map((_, i) => cell(i, 'STUDENT NO:'))).toEqual(['', '200000001', '200000002']);
  });

  it('leaves the bank columns empty, for the administrators to fill in', () => {
    for (let i = 0; i < ROWS.length; i++) {
      expect(['BANK NAME', 'BRANCH CODE', 'ACCOUNT NUMBER'].map((h) => cell(i, h))).toEqual(['', '', '']);
    }
  });
});
