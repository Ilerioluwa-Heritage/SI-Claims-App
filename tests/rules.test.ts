import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  buildSilClaim,
  dataAllowanceHours,
  formatDates,
  formatHours,
  formatRand,
  formatTime,
  parseRand,
  parseTime,
  spreadAllowance,
  workSession,
  type ClassRecord,
  type SiSession,
} from '../src/core/index.ts';

const S = DEFAULT_SETTINGS;
const RATE = parseRand('36.50');

const t = (s: string) => {
  const m = parseTime(s);
  if (m === null) throw new Error(`bad time in test: ${s}`);
  return m;
};
const day = (d: number) => `2026-10-${String(d).padStart(2, '0')}`;
const session = (d: number, start: string, end: string): SiSession => ({ date: day(d), start: t(start), end: t(end) });
const lecture = (d: number, module: string, start: string): ClassRecord => ({ date: day(d), module, start: t(start) });

/** A line as it will read on the form: date, service, in, out, hours. */
const line = (r: { dates: string[]; service: string; timeIn: string; timeOut: string; minutes: number }) =>
  `${formatDates(r.dates)} ${r.service} ${r.timeIn}-${r.timeOut} ${formatHours(r.minutes)}`;

const claim = (sessions: SiSession[], classes: ClassRecord[] = [], settings = S) =>
  buildSilClaim({ sessions, classes, rateCents: RATE }, settings);

describe('rule 3 and 5: one session becomes one line', () => {
  it('rounds, then adds 2h prep and the data hour to the end', () => {
    const w = workSession(session(1, '18:10', '19:50'), 1, S);
    expect([formatTime(w.finalStart), formatTime(w.finalEnd), w.minutes / 60]).toEqual(['18H00', '23H00', 5]);
    expect(w.movedToStart).toBe(0);
  });

  it('may end exactly at 23H30', () => {
    const w = workSession(session(1, '19:00', '21:30'), 0, S);
    expect([formatTime(w.finalStart), formatTime(w.finalEnd), w.movedToStart]).toEqual(['19H00', '23H30', 0]);
  });

  it('holds the end at 23H30 and moves the rest onto the start', () => {
    // 20:00-22:00 + 2h prep + 1h data would end at 01:00; 1.5h moves to the start.
    const w = workSession(session(1, '20:00', '22:00'), 1, S);
    expect([formatTime(w.finalStart), formatTime(w.finalEnd), w.minutes / 60]).toEqual(['18H30', '23H30', 5]);
    expect(w.movedToStart).toBe(90);
  });

  it('a session ending at 23:50 rounds to midnight and is pulled back', () => {
    // 21:00-24:00 is 3h, + 2h prep = 5h, ending no later than 23H30.
    const w = workSession(session(1, '21:00', '23:50'), 0, S);
    expect([formatTime(w.finalStart), formatTime(w.finalEnd), w.minutes / 60]).toEqual(['18H30', '23H30', 5]);
  });

  it('an end typed as 00:00 means midnight', () => {
    const w = workSession(session(1, '22:00', '00:00'), 0, S);
    expect([formatTime(w.finalStart), formatTime(w.finalEnd), w.minutes / 60]).toEqual(['19H30', '23H30', 4]);
  });

  it('never writes 00H00 on a line, for any session and allowance', () => {
    for (let start = 0; start < 1440; start += 7) {
      for (let len = 1; len <= 720 && start + len <= 1440; len += 53) {
        for (const data of [0, 1, 2]) {
          const w = workSession({ date: day(1), start, end: (start + len) % 1440 }, data, S);
          expect(w.finalEnd).toBeLessThanOrEqual(t('23:30'));
          expect(w.finalStart).toBeGreaterThanOrEqual(0);
          expect(w.minutes % 30).toBe(0);
        }
      }
    }
  }, 60_000); // thousands of checks: allow for a slow computer
});

describe('rule 4: data allowance', () => {
  it.each([
    [0, 0],
    [1, 2],
    [4, 2],
    [5, 3],
    [8, 3],
    [9, 4],
    [25, 4],
  ])('%i sessions -> %i hours', (sessions, hours) => {
    expect(dataAllowanceHours(sessions, S.dataAllowanceBands)).toBe(hours);
  });

  it('is spread one hour at a time from the first session', () => {
    expect(spreadAllowance(2, 4)).toEqual([1, 1, 0, 0]);
    expect(spreadAllowance(3, 5)).toEqual([1, 1, 1, 0, 0]);
    expect(spreadAllowance(4, 9)).toEqual([1, 1, 1, 1, 0, 0, 0, 0, 0]);
  });

  it('with one session, that session gets both hours (TO CONFIRM)', () => {
    expect(spreadAllowance(2, 1)).toEqual([2]);
    expect(claim([session(5, '14:00', '15:00')]).rows.map(line)).toEqual([
      '05/10/2026 SI SESSION 14H00-19H00 5',
    ]);
  });

  it('goes to the earliest sessions by date, whatever order they were logged in', () => {
    const r = claim([session(10, '14:00', '15:00'), session(3, '14:00', '15:00'), session(7, '14:00', '15:00')]);
    expect(r.rows.map(line)).toEqual([
      '03/10/2026 SI SESSION 14H00-18H00 4',
      '07/10/2026 SI SESSION 14H00-18H00 4',
      '10/10/2026 SI SESSION 14H00-17H00 3',
    ]);
  });
});

describe('a whole month: 4 vs 5 vs 9 sessions of one hour each', () => {
  const month = (n: number) => claim(Array.from({ length: n }, (_, i) => session(i + 1, '14:00', '15:00')));

  it('4 sessions: 4 x (1h + 2h prep) + 2h data = 14h = R511.00', () => {
    const r = month(4);
    expect(formatHours(r.totalMinutes)).toBe('14');
    expect(formatRand(r.amountCents)).toBe('R511.00');
  });

  it('5 sessions: 5 x 3h + 3h data = 18h = R657.00', () => {
    const r = month(5);
    expect(formatHours(r.totalMinutes)).toBe('18');
    expect(formatRand(r.amountCents)).toBe('R657.00');
  });

  it('9 sessions: 9 x 3h + 4h data = 31h = R1131.50', () => {
    const r = month(9);
    expect(formatHours(r.totalMinutes)).toBe('31');
    expect(formatRand(r.amountCents)).toBe('R1131.50');
  });

  it('every total lands on a whole or half hour', () => {
    const r = claim([session(1, '13:07', '14:52'), session(2, '09:16', '10:44'), session(3, '17:45', '19:15')]);
    expect(r.totalMinutes % 30).toBe(0);
  });
});

describe("rule 6: class attendance, from the lecturer's record", () => {
  const lecturer = [lecture(6, 'MATH101', '07:40'), lecture(6, 'STAT102', '14:10')];

  it('two classes on one day share a line; no prep or data hours; after SI sessions', () => {
    const r = claim([session(20, '14:00', '15:00')], lecturer);
    expect(r.rows.map(line)).toEqual([
      '20/10/2026 SI SESSION 14H00-19H00 5', // 1h + 2h prep + 2h data
      '06/10/2026 CLASS ATTENDANCE 07H40/14H10-09H40/16H10 4',
    ]);
    expect(r.dataAllowanceHours).toBe(2); // classes don't count as sessions
    expect(formatHours(r.totalMinutes)).toBe('9');
  });

  it('uses the actual lecture start, not rounded: 11H10 -> 11H10-13H10, 2h', () => {
    const r = claim([], [lecture(7, 'CHEM101', '11:10')]);
    expect(r.rows.map(line)).toEqual(['07/10/2026 CLASS ATTENDANCE 11H10-13H10 2']);
    expect(r.amountCents).toBe(7300); // 2h x R36.50, same as before
  });

  it('a class recorded twice is counted once', () => {
    const r = claim([], [lecture(6, 'MATH101', '07:40'), lecture(6, 'MATH 101', '07:40')]);
    expect(r.rows.map(line)).toEqual(['06/10/2026 CLASS ATTENDANCE 07H40-09H40 2']);
    expect(r.notes.map((n) => n.kind)).toContain('duplicate-class');
  });

  it('a class recorded twice a few minutes apart is still counted once (the earlier time is kept)', () => {
    const r = claim([], [lecture(6, 'MATH101', '07:42'), lecture(6, 'MATH101', '07:40')]);
    expect(r.rows.map(line)).toEqual(['06/10/2026 CLASS ATTENDANCE 07H40-09H40 2']);
    expect(r.notes.map((n) => n.kind)).toContain('duplicate-class');
  });
});

describe('rule 8: 80-hour cap', () => {
  it('caps the total at 80h and notes it', () => {
    // 30 sessions x 3h + 4h data = 94h
    const r = claim(Array.from({ length: 30 }, (_, i) => session(i + 1, '14:00', '15:00')));
    expect(r.uncappedMinutes / 60).toBe(94);
    expect(formatHours(r.totalMinutes)).toBe('80');
    expect(formatRand(r.amountCents)).toBe('R2920.00');
    expect(r.capped).toBe(true);
    expect(r.notes.find((n) => n.kind === 'cap')?.message).toBe('94h worked, capped at 80h');
  });

  it('exactly 80h is not capped', () => {
    const r = claim(Array.from({ length: 5 }, (_, i) => session(i + 1, '08:00', '22:00')), [], {
      ...S,
      dataAllowanceBands: [],
    });
    // 5 x (14h + 2h prep) = 80h
    expect(r.capped).toBe(false);
    expect(formatHours(r.totalMinutes)).toBe('80');
    expect(r.notes.filter((n) => n.kind === 'cap')).toHaveLength(0);
  });
});

describe('rule 11: fitting 13 lines, never a second form', () => {
  // Sessions that each start half an hour later, so no two lines have the same times.
  const distinct = (n: number) => Array.from({ length: n }, (_, i) => ({ date: day(i + 1), start: 480 + 30 * i, end: 540 + 30 * i }));

  it('combines class lines with the same times first, and stops there if that fits', () => {
    const classes = [12, 13, 14, 15].map((d) => lecture(d, 'MATH101', '11:10'));
    const r = claim(distinct(11), classes);
    expect(r.rows).toHaveLength(12);
    expect(r.rows.filter((row) => row.service === 'SI SESSION').every((row) => row.dates.length === 1)).toBe(true);
    expect(r.rows.at(-1)).toMatchObject({ dates: ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'], timeIn: '11H10', timeOut: '13H10', minutes: 480 });
    expect(line(r.rows.at(-1)!)).toBe('12&13&14&15/10/2026 CLASS ATTENDANCE 11H10-13H10 8');
    expect(r.fitsOnForm).toBe(true);
  });

  it('then combines SI sessions with the same times, if combining classes was not enough', () => {
    const r = claim(
      Array.from({ length: 14 }, (_, i) => session(i + 1, '14:00', '15:00')),
      [20, 21, 22].map((d) => lecture(d, 'MATH101', '11:10')),
    );
    expect(r.rows.map(line)).toEqual([
      '01&02&03&04/10/2026 SI SESSION 14H00-18H00 16',
      '05&06&07&08&09&10&11&12&13&14/10/2026 SI SESSION 14H00-17H00 30',
      '20&21&22/10/2026 CLASS ATTENDANCE 11H10-13H10 6',
    ]);
    expect(r.notes.filter((n) => n.kind === 'combined')).toHaveLength(3);
  });

  it('does not combine anything when 13 lines or fewer', () => {
    const r = claim(Array.from({ length: 13 }, (_, i) => session(i + 1, '14:00', '15:00')));
    expect(r.rows).toHaveLength(13);
    expect(r.notes.filter((n) => n.kind === 'combined')).toHaveLength(0);
  });

  it('flags it when even combining is not enough: no second form, and no line dropped', () => {
    const r = claim(distinct(15));
    expect(r.rows).toHaveLength(15);
    expect(r.fitsOnForm).toBe(false);
    expect(r.notes.filter((n) => n.kind === 'too-many-lines').map((n) => n.message)).toEqual([
      '15 lines even after combining lines with the same times; the form holds 13. This needs your decision before the form can be filled.',
    ]);
    expect(formatHours(r.totalMinutes)).toBe('49'); // every session still counted
  });

  it('writes combined dates as 10&14&17/09/2026', () => {
    expect(formatDates(['2026-09-10', '2026-09-14', '2026-09-17'])).toBe('10&14&17/09/2026');
    expect(formatDates(['2026-10-01'])).toBe('01/10/2026');
  });
});

describe('sessions that cannot be used', () => {
  it('leaves out a session that ends before it starts, and says so', () => {
    const r = claim([session(5, '15:00', '14:00'), session(6, '14:00', '15:00')]);
    expect(r.rows.map(line)).toEqual(['06/10/2026 SI SESSION 14H00-19H00 5']);
    expect(r.notes.find((n) => n.kind === 'invalid-session')?.message).toContain('2026-10-05');
  });
});

describe('settings drive the rules', () => {
  it('a different prep time, cap and rate change the result', () => {
    const settings = { ...S, prepHoursPerSession: 1, monthlyCapHours: 10 };
    const r = buildSilClaim(
      { sessions: Array.from({ length: 5 }, (_, i) => session(i + 1, '14:00', '15:00')), classes: [], rateCents: parseRand('47.00') },
      settings,
    );
    // 5 x (1h + 1h) + 3h data = 13h, capped at 10h, x R47.00
    expect(r.uncappedMinutes / 60).toBe(13);
    expect(formatRand(r.amountCents)).toBe('R470.00');
  });
});
