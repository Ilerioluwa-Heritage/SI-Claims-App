import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS as S } from '../src/core/index.ts';
import { readClassAttendance } from '../src/read/class-attendance.ts';
import { X } from '../src/read/office.ts';

// A made-up class attendance export, laid out like the real Google Form's.
function xlsx(rows: (string | number | null)[][]) {
  const strings: string[] = [];
  const cellXml = (v: string | number | null, ref: string) => {
    if (v === null) return '';
    if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
    if (!strings.includes(v)) strings.push(v);
    return `<c r="${ref}" t="s"><v>${strings.indexOf(v)}</v></c>`;
  };
  const sheet = rows.map((cells, r) => `<row r="${r + 1}">${cells.map((v, c) => cellXml(v, `${String.fromCharCode(65 + c)}${r + 1}`)).join('')}</row>`).join('');
  return zipSync({
    'xl/workbook.xml': strToU8(`<workbook xmlns="${X}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Form responses 1" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>`),
    'xl/sharedStrings.xml': strToU8(`<sst xmlns="${X}">${strings.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet xmlns="${X}"><sheetData>${sheet}</sheetData></worksheet>`),
  });
}

const HEADINGS = ['Timestamp', 'Email address', 'I am:', 'Name & Surname:', 'Student No:', 'Faculty:', 'School:', 'Level:', 'Module Code', 'Module Name:', 'Date:', 'Date of Lecture:', 'Module/Course:', 'Lecture Time:', "Lecturer's Name:"];
const OCT_6 = 46301;
const T11_10 = 670 / 1440;
const sil = (name: string) => [OCT_6, 'leader@example.com', 'An SI Leader', name, 200000001, 'Science', 'Maths', 3, 'MATH101', 'Maths 1', OCT_6, null, null, null, null];
const lecturer = (date: number | string, module: string, time: number | string | null) => [OCT_6, 'lecturer@example.com', 'A lecturer', null, null, null, null, null, null, null, null, date, module, time, 'Dr Made Up'];

describe("reading one SI Leader's class attendance", () => {
  it("takes classes only from the lecturer's rows: date of lecture, module and lecture time", () => {
    const file = readClassAttendance(xlsx([HEADINGS, sil('Example AB'), lecturer(OCT_6, 'MATH101 ', T11_10), sil('Example AB'), lecturer('13/10/2026', 'MATH101', '11:10')]), 'Example AB October Class Attendance (Responses).xlsx', S);
    expect(file).toMatchObject({ name: 'EXAMPLE AB', nameFrom: 'form', problems: [] });
    expect(file.classes.map((c) => `${c.name} ${c.date} ${c.module} ${c.start}`)).toEqual(['EXAMPLE AB 2026-10-06 MATH101 670', 'EXAMPLE AB 2026-10-13 MATH101 670']);
  });

  it("never reads the email, student number or lecturer's name", () => {
    const file = readClassAttendance(xlsx([HEADINGS, sil('Example AB'), lecturer(OCT_6, 'MATH101', T11_10)]), 'a.xlsx', S);
    const all = JSON.stringify(file);
    for (const secret of ['example.com', '200000001', 'Dr Made Up']) expect(all).not.toContain(secret);
  });

  it("uses the file's name when the SI Leader's rows don't give one", () => {
    const file = readClassAttendance(xlsx([HEADINGS, lecturer(OCT_6, 'MATH101', T11_10)]), 'Mampa P October Class Attendance  (Responses).xlsx', S);
    expect([file.name, file.nameFrom, file.classes.length]).toEqual(['MAMPA P', 'file name', 1]);
  });

  it('claims nothing when the name is written in different ways, and says so', () => {
    const file = readClassAttendance(xlsx([HEADINGS, sil('Example AB'), sil('Sample CD'), lecturer(OCT_6, 'MATH101', T11_10)]), 'x.xlsx', S);
    expect(file.classes).toEqual([]);
    expect(file.problems).toEqual(["x.xlsx: the SI Leader's name is written in different ways (EXAMPLE AB, SAMPLE CD), so these classes aren't claimed until it's clear whose they are."]);
  });

  it("flags a lecturer's row with no readable time", () => {
    const file = readClassAttendance(xlsx([HEADINGS, sil('Example AB'), lecturer(OCT_6, 'MATH101', null)]), 'x.xlsx', S);
    expect(file.problems).toEqual(["x.xlsx, row 3: the lecturer's lecture time can't be read, so this class isn't claimed."]);
  });

  it('names a missing column plainly', () => {
    expect(() => readClassAttendance(xlsx([['I am:', 'Name & Surname:']]), 'x.xlsx', S)).toThrow(
      'x.xlsx has no column called "Date of Lecture:" or "Module/Course:" or "Lecture Time:". Check the class attendance column names in the settings.',
    );
  });
});
