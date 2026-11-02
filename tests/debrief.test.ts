import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS as S } from '../src/core/index.ts';
import { levelOf, readDebrief } from '../src/read/debrief.ts';
import { X, readSheet } from '../src/read/office.ts';
import { excelDate, excelTime } from '../src/read/values.ts';

// A made-up debrief export, laid out like the Google Sheets download: text in
// the shared strings, dates and times as Excel numbers. No real names.
function xlsx(rows: (string | number | null)[][]) {
  const strings: string[] = [];
  const cellXml = (v: string | number | null, ref: string) => {
    if (v === null) return '';
    if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
    if (!strings.includes(v)) strings.push(v);
    return `<c r="${ref}" t="s"><v>${strings.indexOf(v)}</v></c>`;
  };
  const sheetRows = rows
    .map((cells, r) => `<row r="${r + 1}">${cells.map((v, c) => cellXml(v, `${String.fromCharCode(65 + c)}${r + 1}`)).join('')}</row>`)
    .join('');
  const sheet = `<worksheet xmlns="${X}"><sheetData>${sheetRows}</sheetData></worksheet>`;
  return zipSync({
    'xl/workbook.xml': strToU8(
      `<workbook xmlns="${X}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Form responses 1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    ),
    'xl/sharedStrings.xml': strToU8(`<sst xmlns="${X}">${strings.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  });
}

const HEADINGS = ['Timestamp', 'Date:', 'Surname & Initials:', 'Module Code', 'Level:', 'Start time:', 'End Time', 'Provide your contact details'];
const OCT_6 = 46301; // Excel's number for 6 October 2026

describe('reading the debrief (Excel)', () => {
  it('reads date, name, module, level and times; Excel numbers become dates and minutes', () => {
    const rows = readDebrief(
      xlsx([HEADINGS, [OCT_6 + 0.9, OCT_6, 'Example AB', 'MATH101', 'Level 4 (Fourth Year)', 0.7500000000000001, 0.8125, 'secret 0820000000']]),
      S,
    );
    expect(rows).toEqual([
      { where: 'row 2', date: '2026-10-06', name: 'Example AB', module: 'MATH101', levelText: 'Level 4 (Fourth Year)', level: '4th year', start: 1080, end: 1170 },
    ]);
  });

  it('also reads dates and times typed as text', () => {
    const [r] = readDebrief(xlsx([HEADINGS, [null, '06/10/2026', 'Example AB', 'MATH101', 'PHD', '18:00', '19H30']]), S);
    expect(r).toMatchObject({ date: '2026-10-06', level: 'PhD', start: 1080, end: 1170 });
  });

  it('never takes columns it was not asked for, such as contact details', () => {
    const sheet = readSheet(xlsx([HEADINGS, [1, OCT_6, 'Example AB', 'MATH101', 'Honours', 0.75, 0.8, 'secret 0820000000']]), (h) => h === 'Date:');
    expect([...sheet.rows[0]!.cells.keys()]).toEqual(['Date:']);
    expect(JSON.stringify(readDebrief(xlsx([HEADINGS, [1, OCT_6, 'Example AB', 'MATH101', 'Honours', 0.75, 0.8, 'secret 0820000000']]), S))).not.toContain('secret');
  });

  it('skips empty rows', () => {
    expect(readDebrief(xlsx([HEADINGS, [], [null, OCT_6, 'Example AB', 'MATH101', 'Masters', 0.75, 0.8]]), S)).toHaveLength(1);
  });

  it('names a missing column plainly', () => {
    expect(() => readDebrief(xlsx([['Date:', 'Surname & Initials:']]), S)).toThrow(
      'The debrief has no column called "Module Code" or "Level:" or "Start time:" or "End Time". Check the debrief column names in the settings.',
    );
  });
});

describe('levels of study', () => {
  it('maps each debrief answer to a level, ignoring case and punctuation', () => {
    expect(levelOf('Level 2 (Second Year)', S)).toBe('2nd year');
    expect(levelOf('level 3 (third year)', S)).toBe('3rd year');
    expect(levelOf('Level 4 (Fourth Year)', S)).toBe('4th year');
    expect(levelOf('Honours', S)).toBe('Honours');
    expect(levelOf('Masters', S)).toBe('Masters');
    expect(levelOf('PHD', S)).toBe('PhD');
  });

  it("returns nothing for an answer it doesn't know, so it gets flagged", () => {
    expect(levelOf('Level 1 (First Year)', S)).toBeNull();
    expect(levelOf('', S)).toBeNull();
  });
});

describe('Excel numbers', () => {
  it('turns Excel dates and times into ours', () => {
    expect(excelDate(OCT_6)).toBe('2026-10-06');
    expect(excelDate(OCT_6 + 0.75)).toBe('2026-10-06');
    expect(excelTime(0.7500000000000001)).toBe(1080);
    expect(excelTime(OCT_6 + 0.75)).toBe(1080);
    expect(excelTime(0.99999)).toBe(0);
  });
});
