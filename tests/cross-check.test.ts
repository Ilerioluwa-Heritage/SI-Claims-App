import { describe, expect, it } from 'vitest';
import { parseTime } from '../src/core/index.ts';
import { crossCheck } from '../src/read/cross-check.ts';
import type { DebriefRow } from '../src/read/debrief.ts';
import type { RegisterRow } from '../src/read/register.ts';

// Made-up rows for one SI Leader.
const day = (d: number) => `2026-10-${String(d).padStart(2, '0')}`;
const reg = (d: number, start: string | null, extra: Partial<RegisterRow> = {}): RegisterRow => ({
  where: `register ${d} ${start}`,
  date: day(d),
  name: 'Example AB',
  module: 'MATH101',
  time: start ? `${start}-` : '',
  start: start ? parseTime(start) : null,
  end: null,
  timeFrom: null,
  observer: '',
  colour: null,
  meaning: null,
  claimed: true,
  problem: null,
  ...extra,
});
const deb = (d: number, start: string): DebriefRow => ({
  where: `debrief ${d} ${start}`,
  date: day(d),
  name: 'Example AB',
  module: 'MATH101',
  levelText: '',
  level: null,
  start: parseTime(start),
  end: null,
});
const where = (rows: { where: string }[]) => rows.map((r) => r.where);

describe('register vs debrief: the register wins', () => {
  it('pairs sessions on the same day that start within 30 minutes of each other', () => {
    const c = crossCheck([reg(5, '18:00'), reg(6, '14:00')], [deb(5, '18:25'), deb(6, '13:30')]);
    expect(c).toEqual({ notInDebrief: [], notInRegister: [], forLeftOut: [] });
  });

  it('a register session with no debrief stays claimed and goes on the side note', () => {
    const c = crossCheck([reg(5, '18:00'), reg(7, '18:00')], [deb(5, '18:00')]);
    expect(where(c.notInDebrief)).toEqual(['register 7 18:00']);
  });

  it('a debrief with no register session is flagged (and never claimed)', () => {
    const c = crossCheck([reg(5, '18:00')], [deb(5, '18:00'), deb(9, '18:00')]);
    expect(where(c.notInRegister)).toEqual(['debrief 9 18:00']);
  });

  it('a debrief that starts more than 30 minutes away is a different session', () => {
    const c = crossCheck([reg(5, '18:00')], [deb(5, '14:00')]);
    expect(where(c.notInDebrief)).toEqual(['register 5 18:00']);
    expect(where(c.notInRegister)).toEqual(['debrief 5 14:00']);
  });

  it('two sessions on one day each need their own debrief', () => {
    const c = crossCheck([reg(8, '09:00'), reg(8, '14:30')], [deb(8, '14:30')]);
    expect(where(c.notInDebrief)).toEqual(['register 8 09:00']);
    expect(c.notInRegister).toEqual([]);
  });

  it('each debrief goes to the closest register session', () => {
    const c = crossCheck([reg(8, '14:00'), reg(8, '14:30')], [deb(8, '14:25'), deb(8, '14:00')]);
    expect(c).toEqual({ notInDebrief: [], notInRegister: [], forLeftOut: [] });
  });

  it('notes a debrief for a session the register marks cancelled, without claiming it', () => {
    const cancelled = reg(2, '18:00', { claimed: false, meaning: 'Session cancelled', colour: 'FF0000' });
    const c = crossCheck([cancelled], [deb(2, '18:00')]);
    expect(c.forLeftOut.map((x) => `${x.register.meaning} / ${x.debrief.where}`)).toEqual(['Session cancelled / debrief 2 18:00']);
    expect(c.notInRegister).toEqual([]);
  });

  it("a flagged register row still pairs with its debrief, but isn't on the side note", () => {
    const flagged = reg(4, '18:00', { claimed: false, problem: 'no end time; 2 debriefs that day could be this session' });
    const c = crossCheck([flagged, reg(6, '18:00', { claimed: false, problem: 'no end time; no debrief for that day' })], [deb(4, '18:10')]);
    expect(c).toEqual({ notInDebrief: [], notInRegister: [], forLeftOut: [] });
  });
});
