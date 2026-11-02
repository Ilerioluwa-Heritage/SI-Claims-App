import { describe, expect, it } from 'vitest';
import { amountCents, formatHours, formatRand, parseRand } from '../src/core/index.ts';

describe('rule 10: money, rounded half-up to the cent', () => {
  it('36.25 h x R36.50 = R1323.125 -> R1323.13 (not R1323.12)', () => {
    const minutes = 36 * 60 + 15;
    expect(formatRand(amountCents(minutes, parseRand('36.50')))).toBe('R1323.13');
  });

  it.each([
    [31, '36.50', 'R1131.50'],
    [80, '36.50', 'R2920.00'],
    [80, '83.00', 'R6640.00'],
    [10.5, '47.00', 'R493.50'],
    [0.5, '62.00', 'R31.00'],
  ])('%f h x R%s = %s', (hours, rate, expected) => {
    expect(formatRand(amountCents(hours * 60, parseRand(rate)))).toBe(expected);
  });

  it('rounds a quarter cent down and three quarters up', () => {
    // At 1 cent an hour, 15 minutes is a quarter cent, 45 minutes three quarters.
    expect(amountCents(15, 1)).toBe(0); // 0.25c -> 0c
    expect(amountCents(45, 1)).toBe(1); // 0.75c -> 1c
    expect(amountCents(30, 1)).toBe(1); // 0.5c  -> 1c (half goes up)
  });
});

describe('reading and writing amounts', () => {
  it.each([
    ['36.50', 3650],
    ['R36.50', 3650],
    ['36.5', 3650],
    ['47', 4700],
    ['R 1 131.50', 113150],
    ['1,131.50', 113150],
  ])('%s -> %i cents', (text, cents) => {
    expect(parseRand(text)).toBe(cents);
  });

  it.each(['', 'abc', '36.505', '-5'])('rejects "%s"', (text) => {
    expect(() => parseRand(text)).toThrow();
  });

  it('writes amounts without a thousands separator', () => {
    expect(formatRand(113150)).toBe('R1131.50');
    expect(formatRand(5)).toBe('R0.05');
  });

  it('writes hours as 4 or 3.5', () => {
    expect(formatHours(240)).toBe('4');
    expect(formatHours(210)).toBe('3.5');
    expect(formatHours(2175)).toBe('36.25');
    expect(() => formatHours(10)).toThrow();
  });
});
