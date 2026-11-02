import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS as S, parseTime } from '../src/core/index.ts';
import type { DebriefRow } from '../src/read/debrief.ts';
import { W } from '../src/read/office.ts';
import { readRegister, readTimeRange, type RegisterRow } from '../src/read/register.ts';
import { readDate } from '../src/read/values.ts';

// Made-up register documents, laid out like the real one. No real names.
const cell = (text: string, fill?: string) =>
  `<w:tc><w:tcPr>${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ''}</w:tcPr>` +
  `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:tc>`;
const row = (...cells: string[]) => `<w:tr>${cells.join('')}</w:tr>`;
const table = (...rows: string[]) => `<w:tbl>${rows.join('')}</w:tbl>`;
const docx = (...tables: string[]) =>
  zipSync({
    'word/document.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}"><w:body>${tables.join('<w:p/>')}</w:body></w:document>`,
    ),
  });

const HEADING = row(...['Date', 'SI Leader', 'SI Module', 'Time', 'Platform', 'No. of students', 'Observer’s Name'].map((t) => cell(t)));
const KEY = table(row(cell('STUDENTS DID NOT ATTEND'), cell('', '00ff00'), cell('SESSION CANCELLED '), cell('', 'ff0000'), cell('SESSION NOT OBSERVED'), cell('', '8064a2')));
const line = (date: string, name: string, time: string, fill?: string) =>
  row(cell(date), ...[name, 'MATH101', time, 'WhatsApp', '4', 'Admin XY'].map((t) => cell(t, fill)));

const read = (...tables: string[]) => readRegister(docx(...tables), S);
const brief = (r: RegisterRow) => `${r.date} ${r.name} ${r.start}-${r.end} ${r.claimed ? 'claimed' : 'not claimed'}${r.problem ? ` (${r.problem})` : ''}`;

describe('reading the daily register (Word)', () => {
  it("carries each day's date down to the rows under it", () => {
    const rows = read(
      KEY,
      table(HEADING, line('Monday 05/10/2026', 'Example AB', '15h30-17h00'), line('', 'Sample CD', '18h00-19h30'), line('Tuesday 06/10/2026', 'Example AB', '09H00 - 10H30')),
    );
    expect(rows.map(brief)).toEqual([
      '2026-10-05 Example AB 930-1020 claimed',
      '2026-10-05 Sample CD 1080-1170 claimed',
      '2026-10-06 Example AB 540-630 claimed',
    ]);
    expect(rows[0]).toMatchObject({ module: 'MATH101', observer: 'Admin XY', time: '15h30-17h00', where: 'table 2, row 2' });
  });

  it('leaves out red (cancelled) and green (no students) rows; claims purple (not observed)', () => {
    const rows = read(
      table(
        HEADING,
        line('Monday 05/10/2026', 'Red AB', '15h30-17h00', 'FF0000'),
        line('', 'Green AB', '15h30-17h00', '00ff00'),
        line('', 'Purple AB', '15h30-17h00', '8064A2'),
        line('', 'Otherpurple AB', '15h30-17h00', '8e7cc3'),
      ),
    );
    expect(rows.map((r) => `${r.name}: ${r.meaning} ${r.claimed}`)).toEqual([
      'Red AB: Session cancelled false',
      'Green AB: Students did not attend false',
      'Purple AB: Session not observed true',
      'Otherpurple AB: Session not observed true',
    ]);
  });

  it('leaves out a cancelled row even when its time is incomplete, without flagging it', () => {
    const [r] = read(table(HEADING, line('Monday 05/10/2026', 'Red AB', '17h00-', 'FF0000')));
    expect(r).toMatchObject({ claimed: false, meaning: 'Session cancelled', problem: null });
  });

  it('reads the colour from any cell but the date, e.g. only the observer cell', () => {
    const observerOnly = row(cell('Monday 05/10/2026'), ...['Green AB', 'MATH101', '15h30-17h00', 'WhatsApp', '0'].map((t) => cell(t)), cell('', '00FF00'));
    const [r] = read(table(HEADING, observerOnly));
    expect(r).toMatchObject({ claimed: false, meaning: 'Students did not attend' });
  });

  it("flags a colour it doesn't know and doesn't claim it", () => {
    const [r] = read(table(HEADING, line('Monday 05/10/2026', 'Yellow AB', '15h30-17h00', 'FFFF00')));
    expect(r).toMatchObject({ claimed: false, problem: "colour FFFF00 isn't in the settings" });
  });

  it('flags a missing end time, a missing time and a missing name', () => {
    const rows = read(
      table(HEADING, line('Monday 05/10/2026', 'Example AB', '15h30-'), line('', 'Example AB', ''), line('', '', '15h30-17h00')),
    );
    expect(rows.map(brief)).toEqual([
      '2026-10-05 Example AB 930-null not claimed (no end time; no debrief to take it from)',
      '2026-10-05 Example AB null-null not claimed (no time; no debrief to take it from)',
      '2026-10-05  930-1020 not claimed (no SI Leader name)',
    ]);
  });

  it('skips the colour key and days with no sessions', () => {
    const emptyDay = row(cell('Monday 05/10/2026'), ...Array.from({ length: 6 }, () => cell('')));
    const rows = read(KEY, table(HEADING, emptyDay, line('Tuesday 06/10/2026', 'Example AB', '15h30-17h00')));
    expect(rows.map((r) => r.date)).toEqual(['2026-10-06']);
  });

  it("reads a week's table that has no heading row, using the columns from before", () => {
    const rows = read(table(HEADING, line('Monday 05/10/2026', 'Example AB', '15h30-17h00')), KEY, table(line('Monday 12/10/2026', 'Sample CD', '14h00-15h30')));
    expect(rows.map((r) => `${r.date} ${r.name}`)).toEqual(['2026-10-05 Example AB', '2026-10-12 Sample CD']);
  });

  it("doesn't carry a date from one week's table into the next", () => {
    const rows = read(table(HEADING, line('Monday 05/10/2026', 'Example AB', '15h30-17h00')), table(HEADING, line('', 'Sample CD', '14h00-15h30')));
    expect(rows[1]).toMatchObject({ date: '', claimed: false, problem: 'no date above this row' });
  });

  it('joins text split across runs, and paragraphs with a space', () => {
    const split = `<w:tc><w:p><w:r><w:t>Exam</w:t></w:r><w:r><w:t>ple</w:t></w:r></w:p><w:p><w:r><w:t>AB</w:t></w:r></w:p></w:tc>`;
    const [r] = read(table(HEADING, row(cell('Monday 05/10/2026'), split, ...['MATH101', '15h30-17h00', 'WhatsApp', '4', ''].map((t) => cell(t)))));
    expect(r!.name).toBe('Example AB');
  });

  it("says plainly when the file isn't a Word document", () => {
    expect(() => readRegister(strToU8('not a zip'), S)).toThrow('This is not a Word or Excel file (.docx or .xlsx).');
  });
});

describe('missing register times come from the debrief', () => {
  const debriefLine = (day: number, name: string, start: string, end: string, where = 'row 2'): DebriefRow => ({
    where,
    date: `2026-10-${String(day).padStart(2, '0')}`,
    name,
    module: 'MATH101',
    levelText: 'Level 3 (Third Year)',
    level: '3rd year',
    start: parseTime(start),
    end: parseTime(end),
  });
  const readWith = (debrief: DebriefRow[], ...lines: string[]) => readRegister(docx(table(HEADING, ...lines)), S, debrief);

  it("takes the end time from the SI Leader's debrief for that session", () => {
    const [r] = readWith([debriefLine(5, 'EXAMPLE. AB', '18:05', '19:30')], line('Monday 05/10/2026', 'Example AB', '18h00-'));
    expect(r).toMatchObject({ start: 1080, end: 1170, claimed: true, problem: null, timeFrom: 'end time from the debrief (row 2)' });
  });

  it("keeps the register's start time even when the debrief's differs a little", () => {
    const [r] = readWith([debriefLine(5, 'Example AB', '18:20', '19:30')], line('Monday 05/10/2026', 'Example AB', '18h00-'));
    expect(r).toMatchObject({ start: 1080, end: 1170 });
  });

  it("takes start and end from the debrief when the register row has no time, if it's the only one that day", () => {
    const [r] = readWith([debriefLine(5, 'Example AB', '13:30', '15:00')], line('Monday 05/10/2026', 'Example AB', ''));
    expect(r).toMatchObject({ start: 810, end: 900, claimed: true, timeFrom: 'time from the debrief (row 2)' });
  });

  it('stays flagged when no single debrief fits', () => {
    const rows = readWith(
      [
        debriefLine(5, 'Sample CD', '18:00', '19:30'), // someone else
        debriefLine(6, 'Example AB', '18:00', '19:30'), // another day
        debriefLine(7, 'Example AB', '14:00', '15:30'), // too far from 18h00
        debriefLine(8, 'Example AB', '13:00', '14:00', 'row 5'),
        debriefLine(8, 'Example AB', '16:00', '17:00', 'row 6'),
        debriefLine(9, 'Example AB', '18:00', '', 'row 7'),
      ],
      line('Monday 05/10/2026', 'Example AB', '18h00-'),
      line('Wednesday 07/10/2026', 'Example AB', '18h00-'),
      line('Thursday 08/10/2026', 'Example AB', ''),
      line('Friday 09/10/2026', 'Example AB', '18h00-'),
    );
    expect(rows.map((r) => `${r.claimed} ${r.problem}`)).toEqual([
      'false no end time; no debrief for that day',
      'false no end time; no debrief that day starts within 30 minutes of it',
      'false no time; 2 debriefs that day could be this session',
      'false no end time; the debrief (row 7) has no time either',
    ]);
  });

  it("doesn't fill a cancelled row", () => {
    const [r] = readWith([debriefLine(5, 'Example AB', '18:00', '19:30')], line('Monday 05/10/2026', 'Example AB', '18h00-', 'FF0000'));
    expect(r).toMatchObject({ claimed: false, timeFrom: null, meaning: 'Session cancelled' });
  });
});

describe('register dates and times', () => {
  it('reads dates with the day name in front, and rejects impossible ones', () => {
    expect(readDate('Monday 06/10/2026')).toBe('2026-10-06');
    expect(readDate('6/10/2026')).toBe('2026-10-06');
    expect(readDate('31/02/2026')).toBeNull();
    expect(readDate('29/02/2028')).toBe('2028-02-29');
    expect(readDate('Monday')).toBeNull();
  });

  it('reads time ranges as typed', () => {
    expect(readTimeRange('15h30-17h00')).toEqual({ start: 930, end: 1020, problem: null });
    expect(readTimeRange('15:30 – 17:00')).toEqual({ start: 930, end: 1020, problem: null });
    expect(readTimeRange('22h00-00h00')).toEqual({ start: 1320, end: 0, problem: null });
    expect(readTimeRange('15h30-').problem).toBe('no end time');
    expect(readTimeRange('3pm-5pm').problem).toBe('time "3pm-5pm" unreadable');
    expect(readTimeRange('15h30-5ish').problem).toBe('end time "15h30-5ish" unreadable');
  });
});
