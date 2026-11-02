// Fills the HRM-05 for two made-up SI Leaders, so you can open the result:
//   EXAMPLE AB - the month from `npm run demo` (one form)
//   EXAMPLE CD - 15 sessions that can't be combined (continues on a second form)
// Run it with:  npm run demo:pdf  [-- "<blank form.pdf>"]
// The blank form defaults to the test copy. The files go to local-data/ (never uploaded).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_SETTINGS as S, buildSilClaim, formatRand, parseRand, parseTime, type ClassRecord, type SiSession } from '../src/core/index.ts';
import { checkClaimForm, fillClaimForm, firstOfNextMonth } from '../src/pdf/fill.ts';

const t = (s: string) => parseTime(s) ?? 0;
const at = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
const examples: { formName: string; sessions: SiSession[]; classes: ClassRecord[] }[] = [
  {
    formName: 'EXAMPLE AB',
    sessions: [
      { date: '2026-10-02', start: t('14:10'), end: t('15:50') },
      { date: '2026-10-07', start: t('18:15'), end: t('19:45') },
      { date: '2026-10-09', start: t('20:00'), end: t('22:20') },
      { date: '2026-10-14', start: t('14:00'), end: t('15:00') },
      { date: '2026-10-21', start: t('14:05'), end: t('15:10') },
    ],
    classes: [
      { date: '2026-10-06', module: 'MATH101', start: t('07:40') },
      { date: '2026-10-06', module: 'STAT102', start: t('14:00') },
    ],
  },
  {
    formName: 'EXAMPLE CD',
    sessions: Array.from({ length: 15 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, start: t(at(420 + i * 30)), end: t(at(480 + i * 30)) })),
    classes: [],
  },
];

const templatePath = process.argv[2] ?? 'tests/fixtures/HRM-05 blank.pdf';
const template = new Uint8Array(readFileSync(templatePath));
const problems = await checkClaimForm(template);
if (problems.length) {
  console.log(`The blank form ${templatePath} can't be used:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
mkdirSync('local-data', { recursive: true });
for (const e of examples) {
  const claim = buildSilClaim({ sessions: e.sessions, classes: e.classes, rateCents: parseRand('36.50') }, S);
  const filled = await fillClaimForm(
    template,
    {
      formName: e.formName,
      month: 10,
      year: 2026,
      submissionDate: firstOfNextMonth(10, 2026),
      pages: claim.pages,
      totalMinutes: claim.totalMinutes,
      rateCents: claim.rateCents,
      amountCents: claim.amountCents,
    },
    S,
  );
  for (const f of filled.files) writeFileSync(`local-data/${f.fileName}`, f.bytes);
  console.log(`${e.formName}: ${claim.rows.length} lines, ${claim.totalMinutes / 60}h, ${formatRand(claim.amountCents)} -> ${filled.files.map((f) => `local-data/${f.fileName}`).join(', ')}`);
  for (const w of filled.warnings) console.log(`  ! ${w}`);
}
