import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS as S, parseCommand, parseRand } from '../src/core/index.ts';
import { readLevelsList } from '../src/read/levels-list.ts';
import { W } from '../src/read/office.ts';
import { levelFromList, rosterWithAdmins } from '../src/run/month.ts';

// A made-up list laid out like the real one, with made-up phone numbers in "Contact".
const cell = (t: string) => `<w:tc><w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p></w:tc>`;
const row = (...cells: string[]) => `<w:tr>${cells.map(cell).join('')}</w:tr>`;
const docx = (...rows: string[]) =>
  zipSync({ 'word/document.xml': strToU8(`<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body><w:tbl>${rows.join('')}</w:tbl></w:body></w:document>`) });
const HEADING = row('', 'Surname & Initials', 'Student #', 'Module Code', '2nd Semester', 'Level of Study', 'Contact');
const LIST = docx(
  HEADING,
  row('1', 'Example AB', '200000001', 'MATH101', 'MATH201', '3rd', '0821111111'),
  row('2', 'Sample C.D', '200000002', 'STAT102', 'N/A', 'PGD(NQF8)', '0822222222'),
  row('3', 'Pattern EF', '200000003', 'BIOL111', 'BIOL121', '1st  ECP', '0823333333'),
  row('', '', '', '', '', '', ''),
  row('5', 'A.B.', '200000005', 'CHEM101', 'CHEM102', 'Honours', '0825555555'),
);

describe('reading the list of SI Leaders (Word)', () => {
  const list = readLevelsList(LIST, S);

  it('reads each SI Leader: name as printed, student number and level', () => {
    expect(list.people.map((p) => `${p.formName} | ${p.studentNumber} | ${p.level}`)).toEqual([
      'EXAMPLE AB | 200000001 | 3rd',
      'SAMPLE CD | 200000002 | PGD(NQF8)',
      'PATTERN EF | 200000003 | 1st ECP', // spaces tidied as Word shows them
    ]);
    expect(list.people.every((p) => p.role === 'SIL' && p.active)).toBe(true);
  });

  it('never reads the Contact column (phone numbers)', () => {
    expect(JSON.stringify(list)).not.toMatch(/082\d{7}/);
  });

  it('flags a row with only initials for a name, and skips empty rows', () => {
    expect(list.problems).toEqual(['row 6: "A.B." has no surname the app can tell apart from the initials, so it isn\'t on the list.']);
  });

  it('says plainly when the columns are not there', () => {
    expect(() => readLevelsList(docx(row('Name', 'Number')), S)).toThrow(
      'The list has no table with the columns "Surname & Initials", "Student #", "Level of Study". Check the list\'s column names in the settings.',
    );
  });
});

describe('levels on the list, and their rates', () => {
  const rate = (text: string) => {
    const level = levelFromList(text, S);
    return level ? `${level} R${S.rates[level]}` : null;
  };

  it('maps every level on the list, including PGD(NQF8) at R47.00 and 1st ECP at R36.50 (decided 3 Nov 2026)', () => {
    expect(['2nd', '3rd', '4th', 'PGCE', 'Honours', 'Masters', 'PhD', 'PGD(NQF8)', '1st  ECP'].map(rate)).toEqual([
      '2nd year R36.50', '3rd year R36.50', '4th year R36.50', 'PGCE R36.50', 'Honours R47.00', 'Masters R62.00', 'PhD R83.00',
      'PGD (NQF 8) R47.00', '1st year ECP R36.50',
    ]);
    expect(rate('Diploma')).toBeNull();
    expect(parseRand(S.rates['PGD (NQF 8)'])).toBe(4700);
  });

  it('lets the editor set these levels too', () => {
    expect(parseCommand('set the level to PGD', { month: 10, year: 2026 })).toMatchObject({ level: 'PGD (NQF 8)' });
    expect(parseCommand('the level is ECP', { month: 10, year: 2026 })).toMatchObject({ level: '1st year ECP' });
  });

  it('adds the administrators from the settings to the people the month is matched against', () => {
    const roster = rosterWithAdmins(readLevelsList(LIST, S).people, S);
    expect(roster.filter((p) => p.role === 'Admin').map((p) => p.formName)).toEqual(S.admins.map((a) => a.name));
    expect(roster).toHaveLength(3 + S.admins.length);
  });
});
