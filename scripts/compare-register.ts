// Compares, per SI Leader, the SI session hours the rules give from the daily
// register with the SI session hours on the form they submitted. Class
// attendance is left out: it needs the lecturers' records.
//
//   node scripts/compare-register.ts <register.docx> <submitted.json> <month> <year> <out.txt>
//
// The summary is printed; the full detail (names, dates, times) goes to
// <out.txt>. Keep that in local-data/, which is never uploaded.

import { readFileSync, writeFileSync } from 'node:fs';
import {
  DEFAULT_SETTINGS as S,
  buildSilClaim,
  formatDates,
  formatHours,
  formatTime,
  matchName,
  normaliseName,
  splitName,
  type RosterPerson,
} from '../src/core/index.ts';
import { readRegister, type RegisterRow } from '../src/read/register.ts';

interface FormLine { row: number; date: string; service: string; timeIn: string; timeOut: string; hours: string }
interface FormFigures { file: string; totals: Record<string, string>; lines: FormLine[] }

const [registerPath, formsPath, monthArg, yearArg, outPath] = process.argv.slice(2);
if (!registerPath || !formsPath || !monthArg || !yearArg || !outPath) {
  throw new Error('Usage: <register.docx> <submitted.json> <month 1-12> <year> <out.txt>');
}
const monthPrefix = `${yearArg}-${monthArg.padStart(2, '0')}-`;

const all = readRegister(readFileSync(registerPath), S);
const rows = all.filter((r) => r.date.startsWith(monthPrefix));
const undated = all.filter((r) => !r.date);

// The submitted forms stand in for a roster: one person per form.
const forms: FormFigures[] = JSON.parse(readFileSync(formsPath, 'utf8'));
const roster: RosterPerson[] = forms.map((f) => {
  const formName = f.file.replace(/\.pdf$/i, '');
  return { ...splitName(formName), formName, level: '', active: true, role: 'SIL', aliases: [] };
});

interface Person { label: string; form?: FormFigures; spellings: Set<string>; notes: Set<string>; rows: RegisterRow[] }
const people = new Map<string, Person>();
for (const f of forms) {
  const label = f.file.replace(/\.pdf$/i, '');
  people.set(label, { label, form: f, spellings: new Set(), notes: new Set(), rows: [] });
}
const noName: RegisterRow[] = [];
for (const r of rows) {
  if (!r.name) {
    noName.push(r);
    continue;
  }
  const m = matchName(r.name, roster);
  const label = m.matched ? m.person.formName : `${normaliseName(r.name)} (no form: ${m.reason})`;
  const p = people.get(label) ?? { label, spellings: new Set(), notes: new Set(), rows: [] };
  p.spellings.add(r.name);
  if (m.matched && m.how !== 'exact') p.notes.add(`"${r.name}" matched by ${m.how}`);
  p.rows.push(r);
  people.set(label, p);
}

const minutesOf = (h: string) => (/^\d+(\.\d+)?$/.test(h.trim()) ? Math.round(Number(h) * 60) : NaN);
const show = (m: number) => (Number.isNaN(m) ? '?' : formatHours(m));

const summary: string[] = [];
const detail: string[] = [];
const head = `${'SI Leader'.padEnd(28)} rows  out  flag  used  rules SI h  form SI h  diff`;
summary.push(head, '-'.repeat(head.length));
let same = 0;
for (const p of [...people.values()].sort((a, b) => a.label.localeCompare(b.label))) {
  const used = p.rows.filter((r) => r.claimed);
  const leftOut = p.rows.filter((r) => !r.problem && !r.claimed);
  const flagged = p.rows.filter((r) => r.problem);
  const claim = buildSilClaim({ sessions: used.map((r) => ({ date: r.date, start: r.start!, end: r.end!, module: r.module })), classes: [], rateCents: 0 }, S);
  const formSi = (p.form?.lines ?? []).filter((l) => l.service.trim().toUpperCase() === 'SI SESSION');
  const formMinutes = p.form ? formSi.reduce((s, l) => s + minutesOf(l.hours), 0) : NaN;
  const diff = claim.uncappedMinutes - formMinutes;
  if (diff === 0) same++;
  const diffText = Number.isNaN(diff) ? 'n/a' : diff === 0 ? 'same' : `${diff > 0 ? '+' : '-'}${formatHours(Math.abs(diff))}`;
  summary.push(
    `${p.label.slice(0, 28).padEnd(28)} ${String(p.rows.length).padStart(4)} ${String(leftOut.length).padStart(4)} ${String(flagged.length).padStart(5)} ${String(used.length).padStart(5)} ${formatHours(claim.uncappedMinutes).padStart(10)} ${(p.form ? show(formMinutes) : '-').padStart(10)}  ${diffText}`,
  );

  if (diff === 0 && !flagged.length && !leftOut.length && !p.notes.size) continue;
  detail.push('', `=== ${p.label}  (rules ${formatHours(claim.uncappedMinutes)}h, form ${p.form ? show(formMinutes) : '-'}h, ${diffText})`);
  if (p.spellings.size > 1 || p.notes.size) detail.push(`  spellings in the register: ${[...p.spellings].join(' | ')}${p.notes.size ? `; ${[...p.notes].join('; ')}` : ''}`);
  detail.push('  Register, worked out by the rules:');
  for (const r of p.rows) {
    const w = claim.sessions.find((s) => s.date === r.date && s.rawStart === r.start);
    const outcome = r.problem
      ? `FLAGGED: ${r.problem}`
      : !r.claimed
        ? `left out: ${r.meaning}`
        : w
          ? `-> ${formatTime(w.finalStart)}-${formatTime(w.finalEnd)} = ${formatHours(w.minutes)}h (+${w.dataMinutes / 60}h data)`
          : '?';
    detail.push(`    ${formatDates([r.date])}  ${r.time.padEnd(13)} ${outcome}`);
  }
  if (p.form) {
    detail.push('  Submitted form, SI session lines:');
    for (const l of formSi) detail.push(`    ${l.date.padEnd(14)} ${`${l.timeIn}-${l.timeOut}`.padEnd(13)} ${l.hours}h`);
  }
}
summary.push('', `${same} of ${people.size} the same. "out" = left out by colour (cancelled / no students); "flag" = can't be read with certainty.`);
if (noName.length) summary.push(`${noName.length} register rows in this month have no SI Leader name.`);
if (undated.length) summary.push(`${undated.length} register rows (any month) have no readable date: ${undated.map((r) => r.where).join(', ')}`);

console.log(summary.join('\n'));
writeFileSync(outPath, [...summary, ...detail, ...noName.map((r) => `no name: ${r.where} ${r.date} ${r.time}`)].join('\n') + '\n');
console.log(`\nDetail written to ${outPath}`);
