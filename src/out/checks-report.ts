// The checks report as a page of its own (HTML), to download, open in any
// browser and print. It holds names, dates, times, hours and amounts only:
// never a student number or any other personal detail.

import { MONTH_NAMES } from '../core/dates.ts';
import { formatHours, formatRand } from '../core/money.ts';
import { CHECK_SECTIONS, type Check, type MonthResult } from '../run/month.ts';

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function checksReportHtml(result: MonthResult, month: number, year: number, checks: Check[] = result.checks): string {
  const title = `SI claims: ${MONTH_NAMES[month - 1]} ${year}`;
  const rows = result.people
    .map((p) => {
      const amount = p.amountCents === null ? 'no rate' : formatRand(p.amountCents);
      return `<tr><td>${escape(p.person.formName)}</td><td>${p.person.role === 'Admin' ? 'Administrator' : 'SI Leader'}</td><td class="n">${formatHours(p.totalMinutes)}</td><td class="n">${p.rateCents === null ? '-' : formatRand(p.rateCents)}</td><td class="n">${amount}</td></tr>`;
    })
    .join('\n');
  const sections = (Object.keys(CHECK_SECTIONS) as (keyof typeof CHECK_SECTIONS)[])
    .map((key) => {
      const items = checks.filter((c) => c.section === key);
      if (!items.length) return '';
      const list = items.map((c) => `<li>${c.person ? `<b>${escape(c.person)}</b>: ` : ''}${escape(c.message)}</li>`).join('\n');
      return `<h3>${escape(CHECK_SECTIONS[key])} (${items.length})</h3>\n<ul>\n${list}\n</ul>`;
    })
    .filter(Boolean)
    .join('\n');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}: checks report</title>
<style>
body{font:15px/1.45 system-ui,sans-serif;margin:24px auto;max-width:900px;padding:0 16px;color:#111}
h1{font-size:22px} h2{font-size:18px;margin-top:28px} h3{font-size:15px;margin:18px 0 6px}
table{border-collapse:collapse;width:100%} td,th{border-bottom:1px solid #ddd;padding:5px 8px;text-align:left}
td.n,th.n{text-align:right;white-space:nowrap} tfoot td{font-weight:bold;border-top:2px solid #111}
li{margin:3px 0} .warn{background:#fff4d6;padding:8px 12px;border-radius:6px}
</style></head><body>
<h1>${escape(title)}: checks report</h1>
${result.complete ? '' : '<p class="warn">Some amounts are missing because there is no rate for that person. See "Levels and rates" below.</p>'}
<h2>Summary</h2>
<table><thead><tr><th>Name</th><th>Role</th><th class="n">Hours</th><th class="n">Rate</th><th class="n">Amount</th></tr></thead>
<tbody>
${rows}
</tbody>
<tfoot><tr><td colspan="4">Total (${result.people.length} people)</td><td class="n">${formatRand(result.totalCents)}</td></tr></tfoot></table>
<h2>Checks</h2>
${sections || '<p>Nothing to check.</p>'}
</body></html>
`;
}
