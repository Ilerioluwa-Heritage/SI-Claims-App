// Checks submitted claim forms (as read by read-submitted-forms.ts) against
// themselves: do the lines add up, does hours x rate give the amount, are the
// SI session times on the half hour, are the dates in the claim month, is the
// order right.
//
//   node scripts/check-submitted-forms.ts local-data/october-2026-submitted.json 10 2026

import { readFileSync } from 'node:fs';
import { amountCents, formatRand, parseRand, parseTime } from '../src/core/index.ts';

interface FormLine { row: number; date: string; service: string; timeIn: string; timeOut: string; hours: string }
interface FormFigures { file: string; totals: Record<string, string>; lines: FormLine[] }

const [file, monthArg, yearArg] = process.argv.slice(2);
if (!file || !monthArg || !yearArg) throw new Error('Usage: <figures.json> <month 1-12> <year>');
const forms: FormFigures[] = JSON.parse(readFileSync(file, 'utf8'));
const month = Number(monthArg);
const year = Number(yearArg);
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

/** Hours text -> minutes, or null. */
const minutes = (h: string) => (/^\d+(\.5)?$/.test(h.trim()) ? Math.round(Number(h) * 60) : null);

/** Minutes -> "5h" or "1h40". */
const asHours = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`;

/** "07&08/10/2026" -> [{d:7,m:10,y:2026},{d:8,...}], or null if unreadable. */
function dates(text: string) {
  const m = /^([\d&\s]+)\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  return m[1]!.split('&').map((d) => ({ d: Number(d), m: Number(m[2]), y: Number(m[3]) }));
}

let grand = 0;
const summary: string[] = [];
for (const f of forms) {
  const name = f.file.replace(/\.pdf$/i, '');
  const issues: string[] = [];
  const t = f.totals;
  const total = minutes(t.hours ?? '');
  let rate: number | null = null;
  try {
    rate = parseRand(t.rate ?? '');
  } catch {
    issues.push(`rate "${t.rate}" unreadable`);
  }

  if (t.hours !== t.hoursAgain) issues.push(`the two total-hours boxes differ (${t.hours} vs ${t.hoursAgain})`);
  if ((t.month ?? '') !== MONTHS[month - 1]) issues.push(`month written as "${t.month}"`);
  if (t.year !== String(year)) issues.push(`year written as "${t.year}"`);

  const lineSum = f.lines.reduce((s, l) => s + (minutes(l.hours) ?? NaN), 0);
  if (total === null) issues.push(`total hours "${t.hours}" unreadable`);
  else if (lineSum !== total) issues.push(`lines add up to ${lineSum / 60}h but the total says ${total / 60}h`);

  if (total !== null && rate !== null) {
    const expected = formatRand(amountCents(total, rate));
    if (expected !== t.amount) issues.push(`amount ${t.amount} but ${t.hours}h x ${t.rate} = ${expected}`);
    grand += amountCents(total, rate);
  }

  let lastKey = '';
  for (const l of f.lines) {
    const where = `line ${l.row} (${l.date || 'no date'})`;
    const ds = dates(l.date);
    if (!ds) issues.push(`${where}: date unreadable`);
    else if (ds.some((d) => d.m !== month || d.y !== year)) issues.push(`${where}: date not in ${MONTHS[month - 1]} ${year}`);
    if (ds && ds.length > 1) issues.push(`${where}: ${ds.length} dates on one line`);

    const ins = l.timeIn.split('/').map(parseTime);
    const outs = l.timeOut.split('/').map(parseTime);
    if ([...ins, ...outs].some((x) => x === null)) {
      issues.push(`${where}: time unreadable (${l.timeIn} - ${l.timeOut})`);
      continue;
    }
    if (/^00H00$/.test(l.timeOut) || /^00H00$/.test(l.timeIn)) issues.push(`${where}: time of 00H00`);
    // SI sessions are rounded; classes use the actual lecture time.
    const service = l.service.toUpperCase();
    const offGrid = [...ins, ...outs].filter((x) => x! % 30 !== 0);
    if (service === 'SI SESSION' && offGrid.length) issues.push(`${where}: time not on the hour or half hour (${l.timeIn} - ${l.timeOut})`);

    const hrs = minutes(l.hours);
    if (ins.length === 1 && outs.length === 1 && (!ds || ds.length === 1)) {
      const out = outs[0] === 0 ? 24 * 60 : outs[0]!;
      if (hrs !== out - ins[0]!) issues.push(`${where}: ${l.timeIn}-${l.timeOut} is ${asHours(out - ins[0]!)} but ${l.hours}h claimed`);
    }

    if (service !== 'SI SESSION' && service !== 'CLASS ATTENDANCE') issues.push(`${where}: service "${l.service}"`);
    const firstDate = ds?.[0] ? `${ds[0].y}${String(ds[0].m).padStart(2, '0')}${String(ds[0].d).padStart(2, '0')}` : '';
    const key = `${service === 'SI SESSION' ? 0 : 1}${firstDate}`;
    if (key < lastKey) issues.push(`${where}: out of order (SI sessions first, then classes, each by date)`);
    lastKey = key;
  }

  summary.push(
    `${name.padEnd(14)} ${String(f.lines.length).padStart(2)} lines  ${(t.hours ?? '').padStart(5)}h  ${(t.rate ?? '').padStart(7)}  ${(t.amount ?? '').padStart(9)}` +
      (issues.length ? `\n${issues.map((i) => `      ! ${i}`).join('\n')}` : ''),
  );
}
console.log(summary.join('\n'));
console.log(`\n${forms.length} forms, total claimed ${formatRand(grand)}`);
