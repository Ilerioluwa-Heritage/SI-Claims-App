// Fills the HRM-05 for made-up SI Leaders, so you can open the result:
//   EXAMPLE AB - the month from `npm run demo`
//   EXAMPLE CD - 11 sessions and 4 classes at the same time: 15 lines, so the
//                classes are combined into one line and it fits on the form
//   EXAMPLE EF - 15 sessions at different times: even combining can't fit it,
//                so no form is filled and it's reported for your decision
// Run it with:  npm run demo:pdf  [-- "<blank form.pdf>"]
// The blank form defaults to the test copy. The files go to local-data/ (never uploaded).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_SETTINGS as S, buildSilClaim, formatRand, parseRand, parseTime, type ClassRecord, type SiSession } from '../src/core/index.ts';
import { checkClaimForm, fillClaimForm, firstOfNextMonth } from '../src/pdf/fill.ts';

const t = (s: string) => parseTime(s) ?? 0;
const day = (d: number) => `2026-10-${String(d).padStart(2, '0')}`;
/** n sessions, each starting half an hour later than the one before, so no two lines match. */
const staggered = (n: number): SiSession[] => Array.from({ length: n }, (_, i) => ({ date: day(i + 1), start: 420 + i * 30, end: 480 + i * 30 }));

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
    sessions: staggered(11),
    classes: [12, 13, 14, 15].map((d) => ({ date: day(d), module: 'MATH101', start: t('11:10') })),
  },
  { formName: 'EXAMPLE EF', sessions: staggered(15), classes: [] },
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
  console.log(`${e.formName}: ${claim.rows.length} lines, ${claim.totalMinutes / 60}h, ${formatRand(claim.amountCents)}`);
  for (const n of claim.notes.filter((n) => n.kind === 'combined' || n.kind === 'too-many-lines')) console.log(`  - ${n.message}`);
  try {
    const filled = await fillClaimForm(
      template,
      {
        formName: e.formName,
        month: 10,
        year: 2026,
        submissionDate: firstOfNextMonth(10, 2026),
        rows: claim.rows,
        totalMinutes: claim.totalMinutes,
        rateCents: claim.rateCents,
        amountCents: claim.amountCents,
      },
      S,
    );
    writeFileSync(`local-data/${filled.fileName}`, filled.bytes);
    console.log(`  -> local-data/${filled.fileName}`);
    for (const w of filled.warnings) console.log(`  ! ${w}`);
  } catch (err) {
    console.log(`  ! No form filled: ${(err as Error).message}`);
  }
}
