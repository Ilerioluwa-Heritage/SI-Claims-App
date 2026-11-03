import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS as S, formatHours, formatRand, parseTime, type RosterPerson } from '../src/core/index.ts';
import type { DebriefRow } from '../src/read/debrief.ts';
import type { RegisterRow } from '../src/read/register.ts';
import { CHECK_SECTIONS, controlListRows, runMonth, type LecturerClass, type MonthResult } from '../src/run/month.ts';

// A made-up month. No real names.
const t = (s: string) => parseTime(s)!;
const day = (d: number, m = 10) => `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const person = (surname: string, initials: string, level: string, role: 'SIL' | 'Admin' = 'SIL'): RosterPerson => ({
  surname, initials, formName: `${surname} ${initials}`, level, active: true, role, aliases: [],
});
let row = 0;
const reg = (date: string, name: string, start: string, end: string | null, extra: Partial<RegisterRow> = {}): RegisterRow => ({
  where: `table 1, row ${++row}`, date, name, module: 'MATH101', time: `${start}-${end ?? ''}`,
  start: t(start), end: end ? t(end) : null, timeFrom: null, observer: '', colour: null, meaning: null, claimed: true, problem: null, ...extra,
});
const deb = (date: string, name: string, start: string, end: string, levelText: string): DebriefRow => ({
  where: `row ${++row}`, date, name, module: 'MATH101', levelText, level: null, start: t(start), end: t(end),
});

const ROSTER = [
  { ...person('EXAMPLE', 'AB', '3rd year'), studentNumber: '200000001' },
  person('SAMPLE', 'CD', 'Honours'),
  person('OTHER', 'EF', ''),
  person('ADMIN', 'GH', 'Masters', 'Admin'),
  person('QUIET', 'IJ', 'PhD'),
];

const REGISTER: RegisterRow[] = [
  reg(day(30, 9), 'Example AB', '18:00', '19:00'), // September: not this month
  reg(day(5), 'Example AB', '18:00', '19:00'),
  reg(day(6), 'Exampl AB', '18:00', '19:00'), // one letter off
  reg(day(7), 'Example AB', '18:00', null, { claimed: false, problem: 'no end time; no debrief for that day' }),
  reg(day(8), 'Example AB', '18:00', null, { claimed: false, meaning: 'Session cancelled', colour: 'FF0000' }),
  reg(day(9), 'Sample CD', '14:00', '15:30', { timeFrom: 'end time from the debrief (row 9)' }),
  reg(day(10), 'Nobody XY', '14:00', '15:00'),
  reg(day(12), 'Sample CD', '14:00', '15:00', { observer: 'Admin GH' }),
  reg('', 'Example AB', '18:00', '19:00', { claimed: false, problem: 'no date above this row' }),
];
const DEBRIEF: DebriefRow[] = [
  deb(day(5), 'EXAMPLE AB', '18:00', '19:00', 'Level 3 (Third Year)'),
  deb(day(9), 'Sample CD', '14:00', '15:30', 'Honours'),
  deb(day(20), 'Sample CD', '18:00', '19:30', 'Masters'),
];
const CLASSES: LecturerClass[] = [
  { where: 'row 2', name: 'Other EF', date: day(14), module: 'STAT102', start: t('11:10') },
  { where: 'row 3', name: 'Unknown ZZ', date: day(15), module: 'STAT102', start: t('11:10') },
];

describe('one month, start to finish (made-up data)', () => {
  let m: MonthResult;
  const sectionOf = (section: keyof typeof CHECK_SECTIONS) => m.checks.filter((c) => c.section === section).map((c) => `${c.person ?? '-'}: ${c.message}`);
  beforeAll(() => {
    m = runMonth({ month: 10, year: 2026, register: REGISTER, debrief: DEBRIEF, classes: CLASSES, roster: ROSTER }, S);
  });

  it('lists everyone with something to claim, alphabetical by surname, with their hours, rate and amount', () => {
    expect(m.people.map((p) => `${p.person.formName} ${formatHours(p.totalMinutes)}h ${p.rateCents === null ? '-' : formatRand(p.rateCents)} ${p.amountCents === null ? '-' : formatRand(p.amountCents)}`)).toEqual([
      'ADMIN GH 80h R62.00 R4960.00',
      'EXAMPLE AB 8h R36.50 R292.00', // 05/10 and 06/10: each 1h + 2h prep + 1h data
      'OTHER EF 2h - -', // a class, but no level on the list
      'SAMPLE CD 8.5h R47.00 R399.50',
    ]);
    expect([formatRand(m.totalCents), m.complete]).toEqual(['R5651.50', false]);
  });

  it('leaves out other months, people with nothing to claim, and names it cannot match', () => {
    expect(m.people.map((p) => p.person.formName)).not.toContain('QUIET IJ');
    expect(sectionOf('unmatched')).toEqual([
      `-: Register, table 1, row 7 (10/10/2026): "Nobody XY": not on the roster.`,
      `-: Class attendance, row 3 (15/10/2026): "Unknown ZZ": not on the roster.`,
    ]);
  });

  it('reports register rows it could not use, rows left out by colour, and times taken from the debrief', () => {
    expect(sectionOf('register-problem')).toEqual([
      'Example AB: table 1, row 9: no date above this row, so it isn\'t counted in any month.',
      'EXAMPLE AB: 07/10/2026 18:00- (table 1, row 4): no end time; no debrief for that day.',
    ]);
    expect(sectionOf('left-out')).toEqual(['EXAMPLE AB: 08/10/2026 18:00- (table 1, row 5): Session cancelled.']);
    expect(sectionOf('filled')).toEqual(['SAMPLE CD: 09/10/2026: 14H00-15H30, end time from the debrief (row 9).']);
  });

  it('register vs debrief: lists register sessions with no debrief (claimed) and flags debriefs with no register session', () => {
    expect(sectionOf('not-on-debrief')).toEqual(['EXAMPLE AB: 06/10/2026', 'SAMPLE CD: 12/10/2026']);
    expect(sectionOf('not-in-register')).toEqual(['SAMPLE CD: 20/10/2026 18H00-19H30 (debrief row 12).']);
  });

  it('notes spelling matches, levels the rates do not know, and debriefs that disagree with the list', () => {
    expect(sectionOf('names')).toEqual(['EXAMPLE AB: "Exampl AB" was matched to EXAMPLE AB (one letter different).']);
    expect(sectionOf('levels')).toEqual([
      'OTHER EF: The list gives the level as "(blank)", which isn\'t a level the rates know, so there\'s no rate.',
      'SAMPLE CD: The debrief says "Masters", but the list says Honours. The list is used.',
    ]);
  });

  it('claims administrators at 80 hours and shows the sessions they observed', () => {
    expect(sectionOf('admins')).toEqual([
      "ADMIN GH: Claimed at 80h x R62.00. What goes on an administrator's form lines hasn't been decided yet, so no form is made.",
      'ADMIN GH: Observed 1 session: 5h by the same rules.',
    ]);
  });

  it('shows how the data allowance was spread, and keeps the report in a fixed order', () => {
    expect(sectionOf('data-allowance')).toEqual([
      'EXAMPLE AB: 2 sessions -> 2h data allowance: 2026-10-05 +1h, 2026-10-06 +1h',
      'SAMPLE CD: 2 sessions -> 2h data allowance: 2026-10-09 +1h, 2026-10-12 +1h',
    ]);
    const order = Object.keys(CHECK_SECTIONS);
    const sections = m.checks.map((c) => order.indexOf(c.section));
    expect(sections).toEqual([...sections].sort((a, b) => a - b));
  });

  it('gives the control list its rows, with student numbers from the levels list', () => {
    expect(controlListRows(m).map((r) => `${r.surname} ${r.initials} [${r.studentNumber}] ${r.level} ${r.minutes / 60} ${r.rateCents}`)).toEqual([
      'ADMIN GH [] Masters 80 6200',
      'EXAMPLE AB [200000001] 3rd year 8 3650',
      'OTHER EF []  2 null',
      'SAMPLE CD [] Honours 8.5 4700',
    ]);
  });

  it('never puts a student number in the checks report', () => {
    expect(JSON.stringify(m.checks)).not.toContain('200000001');
  });
});

describe('people who are not on the SI list: name and level from the debrief (decided 3 Nov 2026)', () => {
  const run = () =>
    runMonth(
      {
        month: 10,
        year: 2026,
        roster: [{ ...person('SAMPLE', 'CD', 'Honours'), studentNumber: '200000002' }],
        register: [
          reg(day(5), 'Newcomer QR', '18:00', '19:00'),
          reg(day(6), 'Sample XY', '18:00', '19:00'),
          reg(day(7), 'Mixed ST', '18:00', '19:00'),
          reg(day(8), 'Nobody ZZ', '18:00', '19:00'),
        ],
        debrief: [
          deb(day(5), 'Newcomer QR', '18:00', '19:00', 'Masters'),
          deb(day(6), 'Sample XY', '18:00', '19:00', 'Level 3 (Third Year)'),
          deb(day(7), 'Mixed ST', '18:00', '19:00', 'Honours'),
          deb(day(9), 'Mixed ST', '18:00', '19:00', 'Masters'),
        ],
        classes: [],
      },
      S,
    );

  it('claims them with the rate their debrief level gives, and no student number', () => {
    const m = run();
    expect(m.people.map((p) => `${p.person.formName} ${p.amountCents === null ? 'no rate' : formatRand(p.amountCents)}`)).toEqual([
      'MIXED ST no rate',
      'NEWCOMER QR R310.00', // 1h + 2h prep + 2h data = 5h x R62.00
      'SAMPLE XY R182.50', // 5h x R36.50
    ]);
    expect(controlListRows(m).map((r) => r.studentNumber)).toEqual(['', '', '']);
  });

  it('says so in the checks, including when the list has someone with the same surname', () => {
    const checks = run().checks.map((c) => `${c.section} ${c.person ?? '-'}: ${c.message}`);
    expect(checks).toContain("names NEWCOMER QR: isn't on the SI list, so the name and level come from the debrief, and the control list has no student number for them.");
    expect(checks).toContain("names SAMPLE XY: isn't on the SI list (the list has SAMPLE CD), so the name and level come from the debrief, and the control list has no student number for them.");
    expect(checks).toContain('levels MIXED ST: Not on the SI list, and the debrief gives "Honours" and "Masters", so there\'s no rate.');
  });

  it('still cannot match a name that is on neither the list nor the debrief', () => {
    expect(run().checks.filter((c) => c.section === 'unmatched').map((c) => c.message)).toEqual([
      expect.stringContaining('"Nobody ZZ": not on the roster.'),
    ]);
  });
});
