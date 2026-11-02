// Try the claim form editor on a submitted form's lines (as read by
// read-submitted-forms.ts). It prints the form before and after; nothing is
// written back to the PDF yet (that comes with stage 2).
//
//   node scripts/edit-claim.ts local-data/october-2026-submitted.json "MATLOU LL" "remove the session of the 07th" "add 1 hour to line 2"

import { readFileSync } from 'node:fs';
import {
  COMMAND_EXAMPLES,
  DEFAULT_SETTINGS as S,
  claimFromForm,
  editClaim,
  formatDates,
  formatRand,
  recalculate,
  showHours,
  type EditableClaim,
} from '../src/core/index.ts';

interface FormFigures { file: string; totals: Record<string, string>; lines: { date: string; service: string; timeIn: string; timeOut: string; hours: string }[] }

const [file, who, ...commands] = process.argv.slice(2);
if (!file || !who) {
  console.log('Usage: <figures.json> "<SURNAME INITIALS>" "<command>" ["<command>" ...]\n\nCommands like:');
  for (const e of COMMAND_EXAMPLES) console.log(`  ${e}`);
  process.exit(1);
}
const forms: FormFigures[] = JSON.parse(readFileSync(file, 'utf8'));
const form = forms.find((f) => f.file.replace(/\.pdf$/i, '').toUpperCase() === who.toUpperCase());
if (!form) throw new Error(`No form called "${who}". Forms: ${forms.map((f) => f.file.replace(/\.pdf$/i, '')).join(', ')}`);

function show(title: string, claim: EditableClaim) {
  const r = recalculate(claim, S);
  console.log(`\n${title}`);
  r.rows.forEach((row, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${formatDates(row.dates).padEnd(16)} ${row.service.padEnd(17)} ${`${row.timeIn}-${row.timeOut}`.padEnd(24)} ${showHours(row.minutes)}h`);
  });
  const rate = claim.rateCents === null ? 'no rate' : formatRand(claim.rateCents);
  const amount = r.amountCents === null ? '-' : formatRand(r.amountCents);
  console.log(`  Total ${showHours(r.totalMinutes)}h x ${rate} = ${amount}`);
  for (const w of r.warnings) console.log(`  ! ${w}`);
}

const { claim: start, problems } = claimFromForm({ month: form.totals.month ?? '', year: form.totals.year ?? '', rate: form.totals.rate ?? '', lines: form.lines });
for (const p of problems) console.log(`! ${p}`);
let claim = start;
show(`${who} as submitted:`, claim);
for (const command of commands) {
  const result = editClaim(claim, command, S);
  console.log(`\n> ${command}`);
  if ('error' in result) {
    console.log(`  ? ${result.error.replace(/\n/g, '\n    ')}`);
    continue;
  }
  console.log(`  ${result.summary}`);
  for (const n of result.notes) console.log(`  Note: ${n}`);
  claim = result.claim;
}
if (commands.length) show(`${who} after the changes:`, claim);
