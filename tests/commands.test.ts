import { describe, expect, it } from 'vitest';
import { parseCommand, parseTime } from '../src/core/index.ts';

const OCT = { month: 10, year: 2026 };
const read = (text: string, form: { month: number | null; year: number | null } = OCT) => parseCommand(text, form);
const t = (s: string) => parseTime(s)!;

describe('editor commands: adding', () => {
  it("reads the SI Administrator's own example", () => {
    expect(read("add a session for the 12th that's 2hrs long that began at 18H00")).toEqual({
      kind: 'add-session',
      date: '2026-10-12',
      start: t('18:00'),
      end: t('20:00'),
    });
  });

  it('reads other ways of saying it', () => {
    const want = { kind: 'add-session', date: '2026-10-12', start: t('18:00'), end: t('20:00') };
    expect(read('add a session on the 12th from 18H00 to 20H00')).toEqual(want);
    expect(read('Add session 12/10 18:00-20:00')).toEqual(want);
    expect(read('add a 2-hour session on 12 October at 6pm')).toEqual(want);
    expect(read('add a session on October 12th 2026 at 18h00 for two hours')).toEqual(want);
    expect(read('add a session on 12/10/2026 at 18H00, 1 hour and 30 minutes, then 30 minutes')).toEqual(want);
  });

  it('reads a class', () => {
    expect(read('add a class on the 14th at 11H10')).toEqual({ kind: 'add-class', date: '2026-10-14', start: t('11:10') });
  });

  it('asks rather than guesses', () => {
    expect(read('add a session for the 12th at 18H00')).toMatchObject({ error: expect.stringContaining('How long was it?') });
    expect(read('add a session at 18H00 for 2hrs')).toMatchObject({ error: expect.stringContaining('On which day?') });
    expect(read('add a session for the 12th 2hrs long')).toMatchObject({ error: expect.stringContaining('What time did it start?') });
    expect(read('add a session on the 12th from 18H00 to 21H00 that is 2hrs long')).toMatchObject({ error: expect.stringContaining("isn't the same as the length") });
    expect(read('add a session on the 31st of November at 18H00 for 2hrs')).toMatchObject({ error: "There's no 31 NOVEMBER 2026." });
    expect(read('add a session for the 12th at 18H00 for 2hrs', { month: null, year: null })).toMatchObject({ error: expect.stringContaining('the month is October 2026') });
    expect(read('make it nicer')).toMatchObject({ error: expect.stringContaining("I couldn't tell what to change.") });
  });
});

describe('editor commands: removing, changing and moving', () => {
  it("reads the SI Administrator's own example", () => {
    expect(read('remove the session of the 07th')).toEqual({
      kind: 'remove',
      target: { date: '2026-10-07', dayOnly: true, service: 'SI SESSION', at: null },
    });
  });

  it('reads a start time, a line number and a class', () => {
    expect(read('remove the session of the 08th at 14H30')).toMatchObject({ target: { date: '2026-10-08', at: t('14:30') } });
    expect(read('remove line 3')).toEqual({ kind: 'remove', target: { line: 3 } });
    expect(read('delete the class on the 6th at 14h00')).toMatchObject({ target: { service: 'CLASS ATTENDANCE', at: t('14:00') } });
  });

  it('reads adding and taking off time', () => {
    expect(read('add 1 hour to the session of the 14th')).toMatchObject({ kind: 'change-hours', minutes: 60 });
    expect(read('give an hour to line 2')).toMatchObject({ kind: 'change-hours', minutes: 60, target: { line: 2 } });
    expect(read('remove 30 minutes from the session of the 14th')).toMatchObject({ kind: 'change-hours', minutes: -30 });
    expect(read('take half an hour off the session of the 14th')).toMatchObject({ kind: 'change-hours', minutes: -30 });
    expect(read('extend the session of the 14th by 1.5 hours')).toMatchObject({ kind: 'change-hours', minutes: 90 });
  });

  it('reads a move', () => {
    expect(read('move the session of the 2nd to the 1st')).toEqual({
      kind: 'move',
      target: { date: '2026-10-02', dayOnly: true, service: 'SI SESSION', at: null },
      to: '2026-10-01',
    });
    expect(read('move line 1 to the 6th')).toMatchObject({ target: { line: 1 }, to: '2026-10-06' });
  });
});

describe('editor commands: rate and month', () => {
  it('reads a rate or a level', () => {
    expect(read('set the rate to R47.00')).toEqual({ kind: 'set-rate', rateCents: 4700, level: null });
    expect(read('the rate is 36,50')).toEqual({ kind: 'set-rate', rateCents: 3650, level: null });
    expect(read('set the level to Honours')).toEqual({ kind: 'set-rate', rateCents: null, level: 'Honours' });
    expect(read('level: 3rd year')).toMatchObject({ level: '3rd year' });
  });

  it('reads the month', () => {
    expect(read('the month is October 2026', { month: null, year: null })).toEqual({ kind: 'set-month', month: 10, year: 2026 });
  });

  it('reads the name, in capitals as printed on the form', () => {
    expect(read('the name is MABUNDA YP')).toEqual({ kind: 'set-name', name: 'MABUNDA YP' });
    expect(read('set the name to Mabunda yp')).toEqual({ kind: 'set-name', name: 'MABUNDA YP' });
    expect(read('name: Sample CD')).toEqual({ kind: 'set-name', name: 'SAMPLE CD' });
    expect(read('the name is')).toMatchObject({ error: expect.stringContaining('Which name?') });
  });
});
