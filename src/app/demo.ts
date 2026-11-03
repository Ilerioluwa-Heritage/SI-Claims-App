// A made-up month (October 2026) for trying the website before real files can
// be read, and for the tests. No real names, student numbers or data.

import type { RosterPerson } from '../core/names.ts';
import { parseTime } from '../core/time.ts';
import type { DebriefRow } from '../read/debrief.ts';
import type { RegisterRow } from '../read/register.ts';
import type { LecturerClass, MonthInputs } from '../run/month.ts';

const t = (s: string) => parseTime(s) ?? 0;
const day = (d: number) => `2026-10-${String(d).padStart(2, '0')}`;

const person = (surname: string, initials: string, level: string, role: 'SIL' | 'Admin' = 'SIL', studentNumber = ''): RosterPerson => ({
  surname, initials, formName: `${surname} ${initials}`, level, active: true, role, aliases: [], studentNumber,
});

export function demoMonth(): MonthInputs {
  let n = 0;
  const reg = (d: number, name: string, time: string, extra: Partial<RegisterRow> = {}): RegisterRow => {
    const [start, end] = time.split('-');
    return {
      where: `table 1, row ${++n}`, date: day(d), name, module: 'MATH101', time,
      start: start ? t(start) : null, end: end ? t(end) : null, timeFrom: null, observer: '',
      colour: null, meaning: null, claimed: true, problem: null, ...extra,
    };
  };
  const deb = (d: number, name: string, start: string, end: string, levelText: string): DebriefRow => ({
    where: `row ${++n}`, date: day(d), name, module: 'MATH101', levelText, level: null, start: t(start), end: t(end),
  });
  const cls = (d: number, name: string, start: string): LecturerClass => ({ where: `row ${++n}`, name, date: day(d), module: 'STAT102', start: t(start) });

  return {
    month: 10,
    year: 2026,
    roster: [
      person('EXAMPLE', 'AB', '3rd year', 'SIL', '200000001'),
      person('SAMPLE', 'CD', 'Honours', 'SIL', '200000002'),
      person('PATTERN', 'EF', 'Masters', 'SIL', '200000003'),
      person('ADMIN', 'GH', 'PhD', 'Admin'),
    ],
    register: [
      reg(1, 'Example AB', '18h00-19h00'),
      reg(2, 'Example AB', '18h15-19h45'),
      reg(7, 'Exampl AB', '20h00-22h20'),
      reg(9, 'Example AB', '17h00-', { claimed: false, meaning: 'Session cancelled', colour: 'FF0000' }),
      reg(14, 'Example AB', '14h00-15h00'),
      reg(21, 'Example AB', '14h05-15h10', { observer: 'Admin GH', colour: '8064A2', meaning: 'Session not observed' }),
      reg(6, 'Sample CD', '11h00-12h52'),
      reg(8, 'Sample CD', '18h00-19h30', { timeFrom: 'end time from the debrief (row 40)', time: '18h00-' }),
      reg(15, 'Sample CD', '13h00-', { claimed: false, problem: 'no end time; no debrief for that day' }),
      reg(20, 'Pattern EF', '18h00-19h45', { observer: 'Admin GH' }),
      reg(22, 'Pattern EF', '18h30-19h45'),
      reg(23, 'Pattern EF', '19h00-20h00'),
      reg(24, 'Pattern EF', '13h00-14h00'),
      reg(27, 'Visitor XY', '15h00-16h00'),
    ],
    debrief: [
      deb(1, 'Example AB', '18:00', '19:00', 'Level 3 (Third Year)'),
      deb(2, 'EXAMPLE A.B', '18:15', '19:45', 'Level 3 (Third Year)'),
      deb(14, 'Example AB', '14:00', '15:00', 'Level 3 (Third Year)'),
      deb(6, 'Sample CD', '11:00', '12:52', 'Masters'),
      deb(8, 'Sample CD', '18:00', '19:30', 'Honours'),
      deb(28, 'Sample CD', '18:00', '19:00', 'Honours'),
      deb(20, 'Pattern EF', '18:00', '19:45', 'Masters'),
      deb(22, 'Pattern EF', '18:30', '19:45', 'Masters'),
      deb(23, 'Pattern EF', '19:00', '20:00', 'Masters'),
      deb(24, 'Pattern EF', '13:00', '14:00', 'Masters'),
    ],
    classes: [
      cls(5, 'Example AB', '07:40'),
      cls(5, 'Example AB', '14:00'),
      cls(12, 'Pattern EF', '11:10'),
      cls(19, 'Pattern EF', '11:10'),
      cls(26, 'Pattern EF', '11:10'),
      cls(13, 'Unknown ZZ', '09:00'),
    ],
  };
}
