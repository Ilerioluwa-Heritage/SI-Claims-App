import { describe, expect, it } from 'vitest';
import { formatTime, parseTime, roundEnd, roundStart } from '../src/core/index.ts';

const t = (s: string) => {
  const m = parseTime(s);
  if (m === null) throw new Error(`bad time in test: ${s}`);
  return m;
};
const start = (s: string) => formatTime(roundStart(t(s)));
const end = (s: string) => formatTime(roundEnd(t(s)));

describe('reading times', () => {
  it.each([
    ['18:30', 1110],
    ['18:30:00', 1110],
    ['18H30', 1110],
    ['18h30', 1110],
    ['6:30 PM', 1110],
    ['6:30 pm', 1110],
    ['12:00 PM', 720],
    ['12:15 AM', 15],
    ['1830', 1110],
    ['07:05', 425],
  ])('%s -> %i minutes', (text, minutes) => {
    expect(parseTime(text)).toBe(minutes);
  });

  it.each(['', 'abc', '25:00', '18:60', '13:00 PM', '18'])('rejects "%s"', (text) => {
    expect(parseTime(text)).toBeNull();
  });

  it('writes times the HRM-05 way', () => {
    expect(formatTime(1080)).toBe('18H00');
    expect(formatTime(450)).toBe('07H30');
    expect(() => formatTime(1440)).toThrow();
  });
});

describe('rule 2: rounding start times', () => {
  it.each([
    ['14:00', '14H00'],
    ['14:10', '14H00'],
    ['14:15', '14H00'], // exactly :15 on a start goes back
    ['14:16', '14H30'],
    ['14:30', '14H30'],
    ['14:45', '14H30'], // exactly :45 on a start goes back
    ['14:46', '15H00'], // :46-:59 go to the next hour
    ['14:59', '15H00'],
  ])('start %s -> %s', (raw, rounded) => {
    expect(start(raw)).toBe(rounded);
  });
});

describe('rule 2: rounding end times', () => {
  it.each([
    ['16:00', '16H00'],
    ['16:14', '16H00'],
    ['16:15', '16H30'], // exactly :15 on an end goes forward
    ['16:30', '16H30'],
    ['16:44', '16H30'],
    ['16:45', '17H00'], // exactly :45 on an end goes forward
    ['16:59', '17H00'],
  ])('end %s -> %s', (raw, rounded) => {
    expect(end(raw)).toBe(rounded);
  });

  it('an end from 23:45 rounds to midnight (rule 5 then pulls it back)', () => {
    expect(roundEnd(t('23:45'))).toBe(1440);
  });
});

describe('rule 2: every rounded time is on the hour or half hour', () => {
  it('for all 1440 minutes of the day', () => {
    for (let m = 0; m < 1440; m++) {
      expect(roundStart(m) % 30).toBe(0);
      expect(roundEnd(m) % 30).toBe(0);
      expect(roundEnd(m)).toBeGreaterThanOrEqual(roundStart(m));
    }
  });
});
