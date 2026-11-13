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

  it('may now end after 23H30 (13 Nov 2026: the limit is midnight)', () => {
    // 19:00-22:00 + 2h prep ends exactly at midnight, with nothing moved.
    const w = workSession(session(1, '19:00', '22:00'), 0, S);
    expect([formatTime(w.finalStart), formatTime(w.finalEnd), w.movedToStart]).toEqual(['19H00', '00H00', 0]);
  });

  it('holds the end at 00H00 and moves the rest onto the start', () => {
    // 20:00-22:00 + 2h prep + 1h data would end at 01:00; 1h moves to the start.
    const w = workSession(session(1, '20:00', '22:00'), 1, S);
    expect([formatTime(w.finalStart), formatTime(w.finalEnd), w.minutes / 60]).toEqual(['19H00', '00H00', 5]);
    expect(w.movedToStart).toBe(60);
  });

  it('a session ending at 23:50 rounds to midnight; the prep moves onto the start', () => {
    // 21:00-24:00 is 3h, + 2h prep = 5h, ending no later than 00H00.
    const w = workSession(session(1, '21:00', '23:50'), 0, S);
    expect([formatTime(w.finalStart), formatTime(w.finalEnd), w.minutes / 60]).toEqual(['19H00', '00H00', 5]);
  });

  it('an end typed as 00:00 means midnight', () => {
    const w = workSession(session(1, '22:00', '00:00'), 0, S);
    expect([formatTime(w.finalStart), formatTime(w.finalEnd), w.minutes / 60]).toEqual(['20H00', '00H00', 4]);
  });

  it('the old 23H30 limit still works if it is set again', () => {
    const w = workSession(session(1, '20:00', '22:00'), 1, { ...S, latestEndTime: '23H30' });
    expect([formatTime(w.finalStart), formatTime(w.finalEnd), w.minutes / 60]).toEqual(['18H30', '23H30', 5]);
  });

  it('never ends after 00H00, for any session and allowance', () => {
    for (let start = 0; start < 1440; start += 7) {
      for (let len = 1; len <= 720 && start + len <= 1440; len += 53) {
        for (const data of [0, 1, 2]) {
          const w = workSession({ date: day(1), start, end: (start + len) % 1440 }, data, S);
          expect(w.finalEnd).toBeLessThanOrEqual(1440);
          expect(() => formatTime(w.finalEnd)).not.toThrow();
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

describe('rule 8: 80-hour cap (13 Nov 2026: classes come off first, then data hours)', () => {
  // 19 sessions of 1h (3h each with prep) and one of 2h (4h): 61h, plus 4h data = 65h.
  const sessions65 = () => [...Array.from({ length: 19 }, (_, i) => session(i + 1, '14:00', '15:00')), session(20, '14:00', '16:00')];
  const classesFrom11 = (n: number) => Array.from({ length: n }, (_, i) => lecture(11 + i, 'MATH101', '11:10'));
  const lines = (r: ReturnType<typeof claim>) => r.rows.map(line);

  it('takes classes off, latest first, to bring it back to 80h', () => {
    // 20 sessions x 3h + 4h data = 64h, + 10 classes (20h) = 84h: 4h over, so 2 classes come off.
    const r = claim(Array.from({ length: 20 }, (_, i) => session(i + 1, '14:00', '15:00')), classesFrom11(10));
    expect(r.uncappedMinutes / 60).toBe(84);
    expect([r.capped, formatHours(r.totalMinutes), formatRand(r.amountCents)]).toEqual([true, '80', 'R2920.00']);
    expect(r.cap?.removedClasses.map((c) => c.date)).toEqual([day(20), day(19)]);
    expect(r.cap?.dataCut).toEqual([]);
    const classLines = lines(r).filter((l) => l.includes('CLASS'));
    expect(classLines).toHaveLength(8);
    expect(classLines.some((l) => l.startsWith('19/10') || l.startsWith('20/10'))).toBe(false);
    expect(r.rows.reduce((n, row) => n + row.minutes, 0)).toBe(80 * 60); // the lines add up to the total
  });

  it('81h: takes 1h off the data hours (the latest session that has data), not a class', () => {
    const r = claim(sessions65(), classesFrom11(8));
    expect(r.uncappedMinutes / 60).toBe(81);
    expect(r.cap?.removedClasses).toEqual([]);
    expect(r.cap?.dataCut).toEqual([{ date: day(4), minutes: 60 }]);
    // Data hours went to the 1st-4th; the 4th's hour is taken off.
    expect(lines(r).slice(0, 5)).toEqual([
      '01/10/2026 SI SESSION 14H00-18H00 4',
      '02/10/2026 SI SESSION 14H00-18H00 4',
      '03/10/2026 SI SESSION 14H00-18H00 4',
      '04/10/2026 SI SESSION 14H00-17H00 3',
      '05/10/2026 SI SESSION 14H00-17H00 3',
    ]);
    expect(lines(r).filter((l) => l.includes('CLASS'))).toHaveLength(8);
    expect(formatHours(r.totalMinutes)).toBe('80');
    expect(r.rows.reduce((n, row) => n + row.minutes, 0)).toBe(80 * 60);
    expect(r.notes.find((n) => n.kind === 'cap')?.message).toBe('81h worked, over the 80h cap: 1h data taken off 04/10/2026');
  });

  it('83h: takes off the latest class (2h), then 1h of data', () => {
    const r = claim(sessions65(), classesFrom11(9));
    expect(r.uncappedMinutes / 60).toBe(83);
    expect(r.cap?.removedClasses.map((c) => c.date)).toEqual([day(19)]);
    expect(r.cap?.dataCut).toEqual([{ date: day(4), minutes: 60 }]);
    expect(r.rows.reduce((n, row) => n + row.minutes, 0)).toBe(80 * 60);
    expect(r.notes.find((n) => n.kind === 'cap')?.message).toBe(
      '83h worked, over the 80h cap: 1 class taken off (MATH101 19/10/2026 11H10); 1h data taken off 04/10/2026',
    );
  });

  it('with no classes, takes the data hours off, latest first; if still over, flags it and fills no form', () => {
    // 30 sessions x 3h + 4h data = 94h: all 4h of data come off, still 10h over.
    const r = claim(Array.from({ length: 30 }, (_, i) => session(i + 1, '14:00', '15:00')));
    expect(r.uncappedMinutes / 60).toBe(94);
    expect(r.cap?.dataCut.map((d) => d.date)).toEqual([day(4), day(3), day(2), day(1)]);
    expect(r.cap?.stillOver).toBe(10 * 60);
    expect([formatHours(r.totalMinutes), formatRand(r.amountCents)]).toEqual(['80', 'R2920.00']);
    expect(r.forms).toEqual([]);
    expect(r.notes.find((n) => n.kind === 'cap')?.message).toContain('Still 10h over with no classes or data hours left to take off');
  });

  it('exactly 80h is not capped', () => {
    const r = claim(Array.from({ length: 5 }, (_, i) => session(i + 1, '08:00', '22:00')), [], {
      ...S,
      dataAllowanceBands: [],
    });
    // 5 x (14h + 2h prep) = 80h
    expect(r.capped).toBe(false);
    expect(r.cap).toBeNull();
    expect(formatHours(r.totalMinutes)).toBe('80');
    expect(r.notes.filter((n) => n.kind === 'cap')).toHaveLength(0);
  });
});

describe('rule 11: fitting 13 lines (13 Nov 2026: at most 2 to a line, else none combined)', () => {
  // Sessions that each start half an hour later, so no two lines have the same times.
  const distinct = (n: number, from = 480) => Array.from({ length: n }, (_, i) => ({ date: day(i + 1), start: from + 30 * i, end: from + 60 + 30 * i }));

  it('combines class lines with the same times first, at most 2 to a line, and stops there if that fits', () => {
    const classes = [12, 13, 14, 15].map((d) => lecture(d, 'MATH101', '11:10'));
    const r = claim(distinct(11), classes);
    expect(r.rows).toHaveLength(13);
    expect(r.rows.filter((row) => row.service === 'SI SESSION').every((row) => row.dates.length === 1)).toBe(true);
    expect(r.rows.slice(-2).map(line)).toEqual(['12&13/10/2026 CLASS ATTENDANCE 11H10-13H10 4', '14&15/10/2026 CLASS ATTENDANCE 11H10-13H10 4']);
    expect(r.forms.map((f) => f.length)).toEqual([13]);
  });

  it('then combines SI sessions with the same times, at most 2 to a line, if combining classes was not enough', () => {
    const r = claim(
      Array.from({ length: 14 }, (_, i) => session(i + 1, '14:00', '15:00')),
      [20, 21, 22].map((d) => lecture(d, 'MATH101', '11:10')),
    );
    expect(r.rows.map(line)).toEqual([
      '01&02/10/2026 SI SESSION 14H00-18H00 8',
      '03&04/10/2026 SI SESSION 14H00-18H00 8',
      '05&06/10/2026 SI SESSION 14H00-17H00 6',
      '07&08/10/2026 SI SESSION 14H00-17H00 6',
      '09&10/10/2026 SI SESSION 14H00-17H00 6',
      '11&12/10/2026 SI SESSION 14H00-17H00 6',
      '13&14/10/2026 SI SESSION 14H00-17H00 6',
      '20&21/10/2026 CLASS ATTENDANCE 11H10-13H10 4',
      '22/10/2026 CLASS ATTENDANCE 11H10-13H10 2',
    ]);
    expect(r.notes.filter((n) => n.kind === 'combined')).toHaveLength(8);
    expect(r.forms).toHaveLength(1);
  });

  it('if combining 2 to a line still does not fit one form, combines nothing: one line each, the rest on form 2', () => {
    // 20 sessions at different times, 2 classes at the same time, and 2 classes on one day: 23 lines.
    const classes = [lecture(21, 'MATH101', '11:10'), lecture(22, 'MATH101', '11:10'), lecture(23, 'MATH101', '07:40'), lecture(23, 'STAT101', '14:00')];
    const r = claim(distinct(20), classes);
    expect(r.rows).toHaveLength(23);
    expect(r.rows.every((row) => row.dates.length === 1)).toBe(true);
    expect(r.rows.slice(-3).map(line)).toEqual([
      '21/10/2026 CLASS ATTENDANCE 11H10-13H10 2',
      '22/10/2026 CLASS ATTENDANCE 11H10-13H10 2',
      '23/10/2026 CLASS ATTENDANCE 07H40/14H00-09H40/16H00 4', // two classes on one day still share a line (rule 6)
    ]);
    expect(r.forms.map((f) => f.length)).toEqual([13, 10]);
    expect(r.forms[0]!.map(line)[0]).toBe('01/10/2026 SI SESSION 08H00-12H00 4');
    expect(r.notes.filter((n) => n.kind === 'combined').map((n) => n.message)).toEqual([
      '22 lines even after combining, more than one form holds, so nothing is combined: 23 lines, one per session or class, over two forms',
    ]);
  });

  it('does not combine anything when 13 lines or fewer', () => {
    const r = claim(Array.from({ length: 13 }, (_, i) => session(i + 1, '14:00', '15:00')));
    expect(r.rows).toHaveLength(13);
    expect(r.notes.filter((n) => n.kind === 'combined')).toHaveLength(0);
  });

  it('uses a second form only when combining is not enough', () => {
    const r = claim(distinct(15));
    expect(r.forms.map((f) => f.length)).toEqual([13, 2]);
    expect(r.notes.filter((n) => n.kind === 'too-many-lines')).toEqual([]);
  });

  it('flags it when even two forms are not enough, and drops no line', () => {
    const r = claim(distinct(27, 360));
    expect(r.rows).toHaveLength(27);
    expect(r.forms).toEqual([]);
    expect(r.notes.filter((n) => n.kind === 'too-many-lines').map((n) => n.message)).toEqual([
      '27 lines; 2 forms hold 26. This needs your decision before the forms can be filled.',
    ]);
    expect(formatHours(r.uncappedMinutes)).toBe('85'); // every session still counted (then capped at 80)
  });

  it('writes combined dates as 10&14/09/2026', () => {
    expect(formatDates(['2026-09-10', '2026-09-14'])).toBe('10&14/09/2026');
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
    // 5 x (1h + 1h) + 3h data = 13h; the 3h of data come off to reach 10h, x R47.00
    expect(r.uncappedMinutes / 60).toBe(13);
    expect(r.rows.reduce((n, row) => n + row.minutes, 0)).toBe(10 * 60);
    expect(formatRand(r.amountCents)).toBe('R470.00');
  });
});
