import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS as S,
  claimFromForm,
  editClaim,
  formatDates,
  formatRand,
  recalculate,
  showHours,
  type EditResult,
  type EditableClaim,
} from '../src/core/index.ts';

// A made-up submitted form for October 2026 at R36.50/h.
const form = (lines: [string, string, string, string, string][], rate = 'R36.50') =>
  claimFromForm({ month: 'OCTOBER', year: '2026', rate, lines: lines.map(([date, service, timeIn, timeOut, hours]) => ({ date, service, timeIn, timeOut, hours })) }).claim;
const FOUR = form([
  ['01/10/2026', 'SI SESSION', '18H00', '22H00', '4'],
  ['07/10/2026', 'SI SESSION', '18H00', '22H00', '4'],
  ['14/10/2026', 'SI SESSION', '18H00', '21H00', '3'],
  ['21/10/2026', 'SI SESSION', '18H00', '21H00', '3'],
]);

const ok = (r: EditResult | { error: string }) => {
  if ('error' in r) throw new Error(r.error);
  return r;
};
const lines = (c: EditableClaim) => recalculate(c, S).rows.map((r) => `${formatDates(r.dates)} ${r.service} ${r.timeIn}-${r.timeOut} ${showHours(r.minutes)}`);
const totals = (c: EditableClaim) => {
  const r = recalculate(c, S);
  return `${showHours(r.totalMinutes)}h ${r.amountCents === null ? '-' : formatRand(r.amountCents)}`;
};

describe('claim form editor', () => {
  it('reads a form and works out its totals', () => {
    expect(totals(FOUR)).toBe('14h R511.00');
    expect(recalculate(FOUR, S).warnings).toEqual([]);
  });

  it("adds a session the way the generator would (the SI Administrator's example)", () => {
    const r = ok(editClaim(FOUR, "add a session for the 12th that's 2hrs long that began at 18H00", S));
    expect(r.summary).toBe('Add an SI session on 12/10/2026: 18H00-20H00 rounds to 18H00-20H00, plus 2h preparation: 18H00-22H00, 4h.');
    expect(lines(r.claim)[2]).toBe('12/10/2026 SI SESSION 18H00-22H00 4'); // in date order
    expect(totals(r.claim)).toBe('18h R657.00');
  });

  it('points out a data allowance band change instead of guessing where the hour goes', () => {
    const r = ok(editClaim(FOUR, 'add a session on the 12th from 18H00 to 20H00', S));
    expect(r.notes).toEqual([
      'The form now has 5 SI sessions, which earn 3h data allowance instead of 2h. That isn\'t changed automatically. To add it: "add 1 hour to the session of the ...". By the rules, data hours go one each to the month\'s first sessions by date.',
    ]);
  });

  it('rounds, and keeps to the 23H30 limit by moving the rest onto the start', () => {
    const r = ok(editClaim(FOUR, 'add a session on the 20th from 21H10 to 23H00', S));
    expect(lines(r.claim)).toContain('20/10/2026 SI SESSION 19H30-23H30 4');
    expect(r.summary).toContain('with 1.5h moved onto the start to finish by 23H30');
  });

  it("removes a session (the SI Administrator's example) and works the amount out again", () => {
    const r = ok(editClaim(FOUR, 'remove the session of the 07th', S));
    expect(r.summary).toBe('Remove the SI session on 07/10/2026 (18H00-22H00, 4h).');
    expect(lines(r.claim)).not.toContain('07/10/2026 SI SESSION 18H00-22H00 4');
    expect(totals(r.claim)).toBe('10h R365.00');
  });

  it('removes one date from a combined line', () => {
    const combined = form([['07&08/10/2026', 'SI SESSION', '18H00', '22H00', '8']]);
    const r = ok(editClaim(combined, 'remove the session of the 7th', S));
    expect(lines(r.claim)).toEqual(['08/10/2026 SI SESSION 18H00-22H00 4']);
  });

  it('asks which, when there are two sessions that day', () => {
    const two = form([
      ['08/10/2026', 'SI SESSION', '09H00', '13H00', '4'],
      ['08/10/2026', 'SI SESSION', '14H30', '18H30', '4'],
    ]);
    expect(editClaim(two, 'remove the session of the 8th', S)).toEqual({
      error: 'There are 2 SI sessions on 08/10/2026: line 1 (09H00-13H00) and line 2 (14H30-18H30). Say which, e.g. "line 2" or "at 14H30".',
    });
    expect(lines(ok(editClaim(two, 'remove the session of the 8th at 14H30', S)).claim)).toEqual(['08/10/2026 SI SESSION 09H00-13H00 4']);
    expect(lines(ok(editClaim(two, 'remove line 1', S)).claim)).toEqual(['08/10/2026 SI SESSION 14H30-18H30 4']);
  });

  it('says so when there is nothing on that day', () => {
    expect(editClaim(FOUR, 'remove the session of the 9th', S)).toEqual({ error: "There's no SI session on 09/10/2026." });
  });

  it('adds and takes off time, keeping to 23H30', () => {
    const late = form([['14/10/2026', 'SI SESSION', '19H00', '22H30', '3.5']]);
    expect(lines(ok(editClaim(late, 'add 1 hour to the session of the 14th', S)).claim)).toEqual(['14/10/2026 SI SESSION 19H00-23H30 4.5']);
    const past = ok(editClaim(late, 'add 1.5 hours to the session of the 14th', S));
    expect(lines(past.claim)).toEqual(['14/10/2026 SI SESSION 18H30-23H30 5']);
    expect(past.summary).toContain('held at 23H30; the rest moved onto the start');
    expect(lines(ok(editClaim(late, 'take 30 minutes off line 1', S)).claim)).toEqual(['14/10/2026 SI SESSION 19H00-22H00 3']);
    expect(editClaim(late, 'add 20 minutes to line 1', S)).toMatchObject({ error: expect.stringContaining('half hours') });
  });

  it('moves a session to another day and puts it back in date order', () => {
    const r = ok(editClaim(FOUR, 'move the session of the 21st to the 3rd', S));
    expect(lines(r.claim)[1]).toBe('03/10/2026 SI SESSION 18H00-21H00 3');
  });

  it("finds a line dated in the wrong month by its day, and moves it into the form's month", () => {
    const wrong = form([['06/11/2026', 'CLASS ATTENDANCE', '09H20', '11H20', '2']]);
    expect(recalculate(wrong, S).warnings).toEqual(["Line 1: 06/11/2026 isn't in OCTOBER 2026."]);
    const r = ok(editClaim(wrong, 'move the class of the 6th to the 6th', S));
    expect(lines(r.claim)).toEqual(['06/10/2026 CLASS ATTENDANCE 09H20-11H20 2']);
    expect(recalculate(r.claim, S).warnings).toEqual([]);
  });

  it('puts two classes on one day on one line, and can take one off again', () => {
    const r = ok(editClaim(form([['06/10/2026', 'CLASS ATTENDANCE', '07H40', '09H40', '2']]), 'add a class on the 6th at 14H10', S));
    expect(lines(r.claim)).toEqual(['06/10/2026 CLASS ATTENDANCE 07H40/14H10-09H40/16H10 4']);
    expect(editClaim(r.claim, 'remove the class of the 6th', S)).toMatchObject({ error: expect.stringContaining('Say which, e.g. "at 14H10"') });
    expect(lines(ok(editClaim(r.claim, 'remove the class of the 6th at 07H40', S)).claim)).toEqual(['06/10/2026 CLASS ATTENDANCE 14H10-16H10 2']);
  });

  it('sets the rate from a level and works the amount out again', () => {
    const r = ok(editClaim(FOUR, 'set the level to Honours', S));
    expect(r.summary).toBe('Set the rate to R47.00 (Honours).');
    expect(totals(r.claim)).toBe('14h R658.00');
  });

  it('flags lines that do not add up when a form is read', () => {
    const bad = form([
      ['22/10/2026', 'SI SESSION', '13H30', '18H30', '5.5'],
      ['07&08/10/2026', 'SI SESSION', '09H00', '20H00', '11'],
    ]);
    expect(recalculate(bad, S).warnings).toEqual([
      'Line 1: 09H00-20H00 on 2 dates is 22h, but 11h is claimed.',
      'Line 2: 13H30-18H30 is 5h, but 5.5h is claimed.',
    ]);
  });

  it('caps the amount at 80h', () => {
    const days = Array.from({ length: 21 }, (_, i) => [`${String(i + 1).padStart(2, '0')}/10/2026`, 'SI SESSION', '18H00', '22H00', '4'] as [string, string, string, string, string]);
    const r = recalculate(form(days), S);
    expect(`${showHours(r.uncappedMinutes)} ${showHours(r.totalMinutes)} ${formatRand(r.amountCents!)}`).toBe('84 80 R2920.00');
  });

  it('works on a blank form once the month and rate are given', () => {
    let blank = claimFromForm({ month: '', year: '', rate: '', lines: [] }).claim;
    expect(recalculate(blank, S).warnings).toEqual([
      'There is no rate yet. Say "set the rate to R36.50" or "set the level to Honours".',
      'There is no month yet. Say "the month is October 2026".',
    ]);
    blank = ok(editClaim(blank, 'the month is October 2026', S)).claim;
    blank = ok(editClaim(blank, 'set the rate to R36.50', S)).claim;
    blank = ok(editClaim(blank, 'add a session on the 5th from 14H00 to 15H00', S)).claim;
    expect(totals(blank)).toBe('3h R109.50');
  });

  it('never changes the claim it was given', () => {
    const before = JSON.stringify(FOUR);
    ok(editClaim(FOUR, 'remove the session of the 07th', S));
    expect(JSON.stringify(FOUR)).toBe(before);
  });
});
