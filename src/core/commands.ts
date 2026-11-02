// Typed commands for the claim form editor, such as
//   "add a session for the 12th that's 2hrs long that began at 18H00"
//   "remove the session of the 07th"
// The app reads them itself with fixed patterns; nothing is sent to an AI
// service. Anything it can't read with certainty comes back as a plain
// question with examples, never a guess.

import { MONTH_NAMES, isoDate, monthNumber } from './dates.ts';
import { parseRand } from './money.ts';
import type { Service } from './rules.ts';
import type { Level } from './settings.ts';
import { formatTime } from './time.ts';

/** Which line a command is about: by line number, or by date (and start time, if given). */
export type Target =
  | { line: number }
  | {
      date: string;
      /** Only a day was typed ("the 7th"); the month and year came from the form. */
      dayOnly: boolean;
      service: Service;
      at: number | null;
    };

export type Command =
  | { kind: 'add-session'; date: string; start: number; end: number }
  | { kind: 'add-class'; date: string; start: number }
  | { kind: 'remove'; target: Target }
  | { kind: 'change-hours'; target: Target; minutes: number }
  | { kind: 'move'; target: Target; to: string }
  | { kind: 'set-rate'; rateCents: number | null; level: Level | null }
  | { kind: 'set-month'; month: number; year: number };

export const COMMAND_EXAMPLES = [
  "add a session for the 12th that's 2hrs long that began at 18H00",
  'add a session on the 12th from 18H00 to 20H00',
  'add a class on the 14th at 11H10',
  'remove the session of the 07th',
  'remove the session of the 08th at 14H30',
  'remove line 3',
  'add 1 hour to the session of the 14th',
  'remove 30 minutes from the session of the 14th',
  'move the session of the 2nd to the 1st',
  'set the rate to R47.00',
  'set the level to Honours',
  'the month is October 2026',
];

const help = (first: string) => ({ error: `${first}\nFor example:\n${COMMAND_EXAMPLES.map((e) => `  ${e}`).join('\n')}` });

const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const UNIT = '(?:hours?|hrs?|h|minutes?|mins?)';

const TIME = /(?<![\d/])(\d{1,2})\s*[h:]\s*(\d{2})(?:\s*(am|pm))?(?!\d)(?!\s*long)|(?<![\d/])(\d{1,2})\s*(am|pm)\b/g;
const DURATION = /(?<![\d.])(\d+(?:[.,]\d+)?)[\s-]*(?:hours?|hrs?|h)(?![a-z\d])(?:\s*(?:and\s*)?(\d{1,2})\s*(?:minutes?|mins?)\b)?|(?<![\d.])(\d+)[\s-]*(?:minutes?|mins?)\b/g;
const LINE = /\bline\s*(?:no\.?\s*|number\s*)?(\d{1,2})\b/g;
const DATES: [RegExp, (m: RegExpMatchArray) => DatePart | null][] = [
  [/(?<![\d:])(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{4}|\d{2}))?(?![\d:])/g, (m) => part(m[1], m[2], m[3])],
  [new RegExp(`(?<!\\d)(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+${MONTH}\\b(?:\\s+(\\d{4}))?`, 'g'), (m) => part(m[1], m[2], m[3])],
  [new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, 'g'), (m) => part(m[2], m[1], m[3])],
  [/(?<!\d)(\d{1,2})(?:st|nd|rd|th)\b/g, (m) => part(m[1])],
  [/\bthe\s+(\d{1,2})\b/g, (m) => part(m[1])],
];

interface DatePart {
  day: number;
  month: number | null;
  year: number | null;
}

function part(day?: string, month?: string, year?: string): DatePart | null {
  const m = month === undefined ? null : /^\d+$/.test(month) ? Number(month) : monthNumber(month);
  if (month !== undefined && m === null) return null;
  const y = year === undefined ? null : Number(year) < 100 ? 2000 + Number(year) : Number(year);
  return { day: Number(day), month: m, year: y };
}

/** Takes matches out of the text as it goes, so no part of the command is read twice. */
function reader(start: string) {
  let text = start;
  return {
    take<T>(re: RegExp, read: (m: RegExpMatchArray) => T | null): { value: T; at: number }[] {
      const found: { value: T; at: number; end: number }[] = [];
      for (const m of text.matchAll(re)) {
        const value = read(m);
        if (value !== null) found.push({ value, at: m.index!, end: m.index! + m[0].length });
      }
      for (const f of found) text = text.slice(0, f.at) + ' '.repeat(f.end - f.at) + text.slice(f.end);
      return found.map(({ value, at }) => ({ value, at }));
    },
  };
}

function readTime(m: RegExpMatchArray): number | null {
  let h = Number(m[1] ?? m[4]);
  const min = Number(m[2] ?? 0);
  const ampm = m[3] ?? m[5];
  if (min > 59) return null;
  if (ampm) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ampm === 'pm' ? 12 : 0);
  }
  return h > 23 ? null : h * 60 + min;
}

function readDuration(m: RegExpMatchArray): number {
  if (m[3] !== undefined) return Number(m[3]);
  return Math.round(Number(m[1]!.replace(',', '.')) * 60) + Number(m[2] ?? 0);
}

const NUMBER_WORDS: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };

/** Lower case, plain quotes and spaces, and "half an hour" / "two hours" written as numbers. */
function tidy(input: string): string {
  return ` ${input} `
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/\bhalf an? hour\b/g, '30 minutes')
    .replace(/\ban? (?:hour|hr) and a half\b/g, '90 minutes')
    .replace(/\ban? (hour|hr)\b/g, '1 hour')
    .replace(new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')})(?=[\\s-]*${UNIT}\\b)`, 'g'), (w) => NUMBER_WORDS[w]!);
}

function levelFrom(text: string): Level | null {
  if (/\b(phd|doctoral|doctorate)\b/.test(text)) return 'PhD';
  if (/\bmasters?\b/.test(text)) return 'Masters';
  if (/\bhonou?rs\b/.test(text)) return 'Honours';
  if (/\bpgce\b/.test(text)) return 'PGCE';
  if (/\b(2nd|second)\b/.test(text)) return '2nd year';
  if (/\b(3rd|third)\b/.test(text)) return '3rd year';
  if (/\b(4th|fourth)\b/.test(text)) return '4th year';
  return null;
}

function parseRate(text: string): Command | { error: string } {
  const level = levelFrom(text);
  if (level) return { kind: 'set-rate', rateCents: null, level };
  const m = /\br?\s*(\d+(?:[.,]\d{1,2})?)\b/.exec(text);
  if (m) {
    try {
      return { kind: 'set-rate', rateCents: parseRand(m[1]!.replace(',', '.')), level: null };
    } catch {
      // falls through to the question below
    }
  }
  return { error: 'What should the rate be? For example: "set the rate to R47.00" or "set the level to Honours".' };
}

function parseMonth(text: string, year: number | null): Command | { error: string } {
  const named = new RegExp(`\\b${MONTH}\\b(?:\\s+(\\d{4}))?`).exec(text);
  const numeric = /\b(\d{1,2})\s*[/-]\s*(\d{4})\b/.exec(text);
  const month = named ? monthNumber(named[1]!) : numeric ? Number(numeric[1]) : null;
  const y = named?.[2] ? Number(named[2]) : numeric ? Number(numeric[2]) : year;
  if (!month || month > 12 || !y) return { error: 'Which month and year? For example: "the month is October 2026".' };
  return { kind: 'set-month', month, year: y };
}

/** Reads one typed command. `form` gives the month and year a bare "the 12th" belongs to. */
export function parseCommand(input: string, form: { month: number | null; year: number | null }): Command | { error: string } {
  const text = tidy(input);
  if (!text.trim()) return help('Type what to change.');
  if (/\b(rate|level)\b/.test(text)) return parseRate(text);
  if (/\bmonth\b/.test(text) && !/\b(session|class|line)\b/.test(text)) return parseMonth(text, form.year);

  const service: Service = /\b(class|classes|lecture|lectures)\b/.test(text) ? 'CLASS ATTENDANCE' : 'SI SESSION';
  const r = reader(text);
  const times = r.take(TIME, readTime).map((f) => f.value);
  const durations = r.take(DURATION, readDuration).map((f) => f.value);
  const lines = r.take(LINE, (m) => Number(m[1])).map((f) => f.value);
  const parts = DATES.flatMap(([re, read]) => r.take(re, read)).sort((a, b) => a.at - b.at);

  const dates: { date: string; dayOnly: boolean }[] = [];
  for (const { value: p } of parts) {
    const month = p.month ?? form.month;
    const year = p.year ?? form.year;
    if (month === null || year === null) {
      return { error: 'Which month is this form for? Say it first, e.g. "the month is October 2026", or type the full date, e.g. "12/10/2026".' };
    }
    const date = isoDate(p.day, month, year);
    if (!date) return { error: `There's no ${p.day} ${MONTH_NAMES[month - 1] ?? `month ${month}`} ${year}.` };
    dates.push({ date, dayOnly: p.month === null });
  }
  const minutes = durations.reduce((a, b) => a + b, 0);
  const target = (which = 0): Target | null => {
    if (lines.length) return { line: lines[0]! };
    const d = dates[which];
    return d ? { ...d, service, at: times[0] ?? null } : null;
  };
  const noTarget = { error: 'Which session? Give the day (e.g. "the session of the 7th") or the line number (e.g. "line 3").' };

  const withDuration = (verbs: string, link: string) =>
    new RegExp(`\\b(${verbs})\\s+(?:an?\\s+)?(?:extra\\s+)?\\d[\\d.,]*[\\s-]*${UNIT}\\b.*\\b(${link})\\s+(?:of\\s+)?(?:the\\s+)?(session|class|line)\\b`).test(text);
  const adding = withDuration('add|give', 'to|onto') || (/\b(extend|lengthen)\b/.test(text) && durations.length > 0);
  const removing = withDuration('remove|take|subtract|deduct|cut', 'from|off') || (/\b(shorten|reduce)\b/.test(text) && durations.length > 0);

  if (adding || removing) {
    const t = target();
    if (!t) return noTarget;
    if (!minutes) return { error: 'How much time? For example: "add 1 hour to the session of the 14th".' };
    return { kind: 'change-hours', target: t, minutes: adding ? minutes : -minutes };
  }

  if (/\b(move|shift)\b|\bchange the date\b/.test(text)) {
    const to = dates[dates.length - 1];
    const t = lines.length ? target() : dates.length >= 2 ? target(0) : null;
    if (!t || !to) return { error: 'Move which session, to which day? For example: "move the session of the 2nd to the 1st".' };
    return { kind: 'move', target: t, to: to.date };
  }

  if (/\b(remove|delete|drop|erase|cancel)\b|\btake out\b/.test(text)) {
    const t = target();
    if (!t) return noTarget;
    if (dates.length > 1) return { error: 'Remove which day? I found more than one date in that.' };
    return { kind: 'remove', target: t };
  }

  if (/\b(add|insert|include|record|enter)\b/.test(text)) {
    if (dates.length !== 1) {
      return { error: dates.length ? 'Which day? I found more than one date in that.' : 'On which day? For example: "add a session for the 12th ...".' };
    }
    const date = dates[0]!.date;
    const start = times[0];
    if (service === 'CLASS ATTENDANCE') {
      if (start === undefined) return { error: 'What time did the lecture start? For example: "add a class on the 14th at 11H10".' };
      return { kind: 'add-class', date, start };
    }
    if (start === undefined) return { error: 'What time did it start? For example: "... that began at 18H00".' };
    let end = times[1];
    if (end !== undefined && minutes && (end - start + 24 * 60) % (24 * 60) !== minutes) {
      return { error: `${formatTime(start)} to ${formatTime(end)} isn't the same as the length you gave. Give either the end time or the length.` };
    }
    if (end === undefined) {
      if (!minutes) return { error: 'How long was it? For example: "2hrs long", or "until 20H00".' };
      if (start + minutes > 24 * 60) return { error: 'A session must finish by midnight.' };
      end = (start + minutes) % (24 * 60);
    }
    if (end <= start && end !== 0) return { error: `It can't end (${formatTime(end)}) before it starts (${formatTime(start)}).` };
    return { kind: 'add-session', date, start, end };
  }

  return help("I couldn't tell what to change.");
}
