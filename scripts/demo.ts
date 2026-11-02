// A made-up SI Leader's month, run through the real rules, so you can see
// every step. Run it with:  npm run demo
// (No real names or data: this is only an example.)

import {
  DEFAULT_SETTINGS as settings,
  buildSilClaim,
  formatDates,
  formatHours,
  formatRand,
  formatTime,
  parseRand,
  parseTime,
  type ClassRecord,
  type SiSession,
} from '../src/core/index.ts';

const t = (s: string) => parseTime(s) ?? 0;
const sessions: SiSession[] = [
  { date: '2026-10-02', start: t('14:10'), end: t('15:50'), module: 'MATH101' },
  { date: '2026-10-07', start: t('18:15'), end: t('19:45'), module: 'MATH101' },
  { date: '2026-10-09', start: t('20:00'), end: t('22:20'), module: 'MATH101' },
  { date: '2026-10-14', start: t('14:00'), end: t('15:00'), module: 'MATH101' },
  { date: '2026-10-21', start: t('14:05'), end: t('15:10'), module: 'MATH101' },
];
// From the lecturers' class attendance records.
const classes: ClassRecord[] = [
  { date: '2026-10-06', module: 'MATH101', start: t('07:40') },
  { date: '2026-10-06', module: 'STAT102', start: t('14:00') },
];

const claim = buildSilClaim({ sessions, classes, rateCents: parseRand('36.50') }, settings);

const pad = (s: string, n: number) => s.padEnd(n);
console.log('\nEXAMPLE AB (3rd year, R36.50/h) - OCTOBER 2026\n');
console.log('How each SI session was worked out:');
console.log(pad('Date', 12) + pad('Logged', 14) + pad('Rounded', 14) + pad('+Prep', 7) + pad('+Data', 7) + pad('Moved', 7) + 'On the form');
for (const w of claim.sessions) {
  console.log(
    pad(w.date, 12) +
      pad(`${formatTime(w.rawStart)}-${formatTime(w.rawEnd)}`, 14) +
      pad(`${formatTime(w.roundedStart)}-${formatTime(w.roundedEnd)}`, 14) +
      pad(`${w.prepMinutes / 60}h`, 7) +
      pad(w.dataMinutes ? `${w.dataMinutes / 60}h` : '-', 7) +
      pad(w.movedToStart ? `${w.movedToStart / 60}h` : '-', 7) +
      `${formatTime(w.finalStart)}-${formatTime(w.finalEnd)} = ${formatHours(w.minutes)}h`,
  );
}

console.log('\nLines on the HRM-05:');
claim.rows.forEach((r, i) => {
  console.log(`${String(i + 1).padStart(2)}. ${pad(formatDates(r.dates), 12)} ${pad(r.service, 17)} ${pad(r.timeIn, 12)} ${pad(r.timeOut, 12)} ${formatHours(r.minutes)}`);
});
console.log(`\nTotal: ${formatHours(claim.totalMinutes)} hours x ${formatRand(claim.rateCents)} = ${formatRand(claim.amountCents)}`);

console.log('\nChecks:');
for (const n of claim.notes) console.log(`  - ${n.message}`);
console.log();
