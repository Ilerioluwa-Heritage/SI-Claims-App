// Compares, per SI Leader, the SI session hours the rules give from the daily
// register with the SI session hours on the form they submitted, and the rate
// their debrief level gives with the rate on the form. Class attendance is
// left out: it needs the lecturers' records.
//
//   node scripts/compare-register.ts <register.docx> <debrief.xlsx> <submitted.json> <month> <year> <out.txt>
//
// The summary is printed; the full detail (names, dates, times) goes to
// <out.txt>. Keep that in local-data/, which is never uploaded.

import { readFileSync, writeFileSync } from 'node:fs';
import {
  DEFAULT_SETTINGS as S,
  buildSilClaim,
  formatDates,
  formatHours,
  formatRand,
  formatTime,
  matchName,
  normaliseName,
  parseRand,
  splitName,
  type RosterPerson,
} from '../src/core/index.ts';
import { crossCheck } from '../src/read/cross-check.ts';
import { readDebrief, type DebriefRow } from '../src/read/debrief.ts';
import { readRegister, type RegisterRow } from '../src/read/register.ts';

interface FormLine { row: number; date: string; service: string; timeIn: string; timeOut: string; hours: string }
interface FormFigures { file: string; totals: Record<string, string>; lines: FormLine[] }

const [registerPath, debriefPath, formsPath, monthArg, yearArg, outPath] = process.argv.slice(2);
if (!registerPath || !debriefPath || !formsPath || !monthArg || !yearArg || !outPath) {
  throw new Error('Usage: <register.docx> <debrief.xlsx> <submitted.json> <month 1-12> <year> <out.txt>');
}
const monthPrefix = `${yearArg}-${monthArg.padStart(2, '0')}-`;

const allDebrief = readDebrief(readFileSync(debriefPath), S);
const debrief = allDebrief.filter((d) => d.date.startsWith(monthPrefix));
const all = readRegister(readFileSync(registerPath), S, allDebrief);
const rows = all.filter((r) => r.date.startsWith(monthPrefix));
const undated = all.filter((r) => !r.date);

// The submitted forms stand in for a roster: one person per form.
const forms: FormFigures[] = JSON.parse(readFileSync(formsPath, 'utf8'));
const roster: RosterPerson[] = forms.map((f) => {
  const formName = f.file.replace(/\.pdf$/i, '');
  return { ...splitName(formName), formName, level: '', active: true, role: 'SIL', aliases: [] };
});

interface Person {
  label: string;
  form?: FormFigures;
  spellings: Set<string>;
  notes: Set<string>;
  rows: RegisterRow[];
  debrief: DebriefRow[];
}
const people = new Map<string, Person>();
for (const f of forms) {
  const label = f.file.replace(/\.pdf$/i, '');
  people.set(label, { label, form: f, spellings: new Set(), notes: new Set(), rows: [], debrief: [] });
}
const personFor = (name: string, source: string) => {
  const m = matchName(name, roster);
  const label = m.matched ? m.person.formName : `${normaliseName(name)} (no form)`;
  const p = people.get(label) ?? { label, spellings: new Set(), notes: new Set(), rows: [], debrief: [] };
  people.set(label, p);
  if (m.matched && m.how !== 'exact') p.notes.add(`${source} "${name}" matched by ${m.how}`);
  return p;
};
const noName: RegisterRow[] = [];
for (const r of rows) {
  if (!r.name) {
    noName.push(r);
    continue;
  }
  const p = personFor(r.name, 'register');
  p.spellings.add(r.name);
  p.rows.push(r);
}
for (const d of debrief) personFor(d.name, 'debrief').debrief.push(d);

const minutesOf = (h: string) => (/^\d+(\.\d+)?$/.test(h.trim()) ? Math.round(Number(h) * 60) : NaN);
const show = (m: number) => (Number.isNaN(m) ? '?' : formatHours(m));

const summary: string[] = [];
const detail: string[] = [];
const sideNote: string[] = [];
const debriefOnly: string[] = [];
const leftOutWithDebrief: string[] = [];
const head = `${'SI Leader'.padEnd(24)} rows out flag used  rules h   form h  diff    level -> rate      form rate  reg/deb only`;
summary.push(head, '-'.repeat(head.length));
let same = 0;
let rateIssues = 0;
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

  // Level of study from the debrief, and the rate it gives.
  const levels = [...new Set(p.debrief.map((d) => d.level ?? `unknown "${d.levelText}"`))];
  const level = levels.length === 1 && !levels[0]!.startsWith('unknown') ? levels[0]! : null;
  const rate = level ? formatRand(parseRand(S.rates[level as keyof typeof S.rates])) : null;
  const levelText = level ? `${level} -> ${rate}` : levels.length ? `MIXED: ${levels.join(' / ')}` : 'no debrief';
  const formRate = p.form?.totals.rate ?? '';
  const rateOk = !p.form || (rate !== null && formRate === rate);
  if (!rateOk) rateIssues++;

  // Register vs debrief: the register wins.
  const check = crossCheck(p.rows, p.debrief);
  const regOnly = check.notInDebrief.map((r) => r.date);
  const debOnly = check.notInRegister.map((d) => d.date);
  if (regOnly.length) sideNote.push(`  ${p.label}: ${regOnly.map((d) => formatDates([d])).join(', ')}`);
  for (const d of check.notInRegister) {
    const times = `${d.start === null ? '?' : formatTime(d.start)}-${d.end === null ? '?' : formatTime(d.end)}`;
    debriefOnly.push(`  ${p.label}: ${d.date ? formatDates([d.date]) : 'no date'} ${times} (debrief ${d.where})`);
  }
  for (const { register: r, debrief: d } of check.forLeftOut) {
    leftOutWithDebrief.push(`  ${p.label}: ${formatDates([r.date])} ${r.time} - register says "${r.meaning}", but there's a debrief (${d.where})`);
  }

  summary.push(
    `${p.label.slice(0, 24).padEnd(24)} ${String(p.rows.length).padStart(4)} ${String(leftOut.length).padStart(3)} ${String(flagged.length).padStart(4)} ${String(used.length).padStart(4)} ${formatHours(claim.uncappedMinutes).padStart(7)} ${(p.form ? show(formMinutes) : '-').padStart(8)}  ${diffText.padEnd(6)}  ${levelText.slice(0, 17).padEnd(17)}  ${(formRate || '-').padEnd(7)}${rateOk ? '   ' : ' ! '} ${regOnly.length}/${debOnly.length}`,
  );

  const filled = p.rows.filter((r) => r.timeFrom);
  if (diff === 0 && rateOk && !flagged.length && !leftOut.length && !filled.length && !p.notes.size && !regOnly.length && !debOnly.length) continue;
  detail.push('', `=== ${p.label}  (rules ${formatHours(claim.uncappedMinutes)}h, form ${p.form ? show(formMinutes) : '-'}h, ${diffText}; ${levelText}, form rate ${formRate || '-'})`);
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
    const time = r.timeFrom ? `${formatTime(r.start!)}-${formatTime(r.end!)}*` : r.time;
    detail.push(`    ${formatDates([r.date])}  ${time.padEnd(13)} ${outcome}${r.timeFrom ? `   (* ${r.timeFrom})` : ''}`);
  }
  if (p.form) {
    detail.push('  Submitted form, SI session lines:');
    for (const l of formSi) detail.push(`    ${l.date.padEnd(14)} ${`${l.timeIn}-${l.timeOut}`.padEnd(13)} ${l.hours}h`);
  }
  if (regOnly.length) detail.push(`  In the register but not on the debrief (claimed): ${regOnly.map((d) => formatDates([d])).join(', ')}`);
  if (debOnly.length) detail.push(`  On the debrief but not in the register (not claimed): ${debOnly.map((d) => (d ? formatDates([d]) : 'no date')).join(', ')}`);
}
summary.push(
  '',
  'SIDE NOTE - sessions in the register but not on the debrief (claimed, because the register wins):',
  ...(sideNote.length ? sideNote : ['  none']),
  '',
  'FLAGGED - debriefs with no session in the register (not claimed; a session may be missing from the register):',
  ...(debriefOnly.length ? debriefOnly : ['  none']),
);
if (leftOutWithDebrief.length) summary.push('', 'NOTE - debriefs for sessions the register leaves out (not claimed):', ...leftOutWithDebrief);
summary.push(
  '',
  `${same} of ${people.size} the same hours; ${rateIssues} rate differences (marked !).`,
  `"out" = left out by colour (cancelled / no students); "flag" = can't be read with certainty; "reg/deb only" = days in the register with no debrief / debriefs with nothing in the register.`,
);
if (noName.length) summary.push(`${noName.length} register rows in this month have no SI Leader name.`);
if (undated.length) summary.push(`${undated.length} register rows (any month) have no readable date: ${undated.map((r) => r.where).join(', ')}`);
const undatedDebrief = allDebrief.filter((d) => !d.date);
if (undatedDebrief.length) summary.push(`${undatedDebrief.length} debrief rows have no readable date: ${undatedDebrief.map((d) => d.where).join(', ')}`);

console.log(summary.join('\n'));
writeFileSync(outPath, [...summary, ...detail, ...noName.map((r) => `no name: ${r.where} ${r.date} ${r.time}`)].join('\n') + '\n');
console.log(`\nDetail written to ${outPath}`);
