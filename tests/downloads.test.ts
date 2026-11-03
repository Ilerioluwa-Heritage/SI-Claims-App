import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS as S, formatHours, formatRand } from '../src/core/index.ts';
import { demoMonth } from '../src/app/demo.ts';
import { makeDownloads, type Downloads } from '../src/app/downloads.ts';
import { runMonth, type MonthResult } from '../src/run/month.ts';

const CLAIM_FORM = new Uint8Array(readFileSync('tests/fixtures/HRM-05 blank.pdf'));

describe('a whole made-up month, through to the downloads', () => {
  let result: MonthResult;
  let d: Downloads;
  beforeAll(async () => {
    result = runMonth(demoMonth(), S);
    d = await makeDownloads(result, CLAIM_FORM, 10, 2026, S);
  }, 120_000);

  it('works out everyone: SI Leaders from the register and classes, the administrator at 80h', () => {
    // Worked out by hand:
    // EXAMPLE AB, 5 sessions so 3h data: 01/10 1+2+1=4, 02/10 18H00-20H00 2+2+1=5,
    //   07/10 20H00-22H30 2.5+2+1=5.5 (held at 23H30), 14/10 3, 21/10 3, two classes 4 = 24.5h x R36.50
    // PATTERN EF, 4 sessions so 2h data: 5 + 4.5 + 3 + 3, three classes 6 = 21.5h x R62.00
    // SAMPLE CD, 2 sessions so 2h data: 11H00-13H00 2+2+1=5, 18H00-19H30 1.5+2+1=4.5 = 9.5h x R47.00
    // ADMIN GH: 80h x R83.00
    expect(result.people.map((p) => `${p.person.formName} ${formatHours(p.totalMinutes)}h ${p.amountCents === null ? '-' : formatRand(p.amountCents)}`)).toEqual([
      'ADMIN GH 80h R6640.00',
      'EXAMPLE AB 24.5h R894.25',
      'PATTERN EF 21.5h R1333.00',
      'SAMPLE CD 9.5h R446.50',
    ]);
    expect(result.complete).toBe(true);
  });

  it('makes one form per SI Leader (none for the administrator yet), named after them', () => {
    expect(d.forms.map((f) => f.fileName)).toEqual(['EXAMPLE AB.pdf', 'PATTERN EF.pdf', 'SAMPLE CD.pdf']);
  });

  it('puts the forms, the control list and the checks report in one zip', () => {
    expect(Object.keys(unzipSync(d.zip.bytes))).toEqual([
      'EXAMPLE AB.pdf',
      'PATTERN EF.pdf',
      'SAMPLE CD.pdf',
      'Control list OCTOBER 2026.xlsx',
      'Checks report OCTOBER 2026.html',
    ]);
  });

  it("adds what filling the forms found to the checks: two classes on one day don't fit the time boxes", () => {
    expect(d.checks.filter((c) => c.section === 'form-text').map((c) => c.person)).toEqual(['EXAMPLE AB', 'EXAMPLE AB']);
  });

  it('writes a checks report with the summary and every section that has something in it', () => {
    const html = strFromU8(d.report.bytes);
    expect(html).toContain('<h1>SI claims: OCTOBER 2026: checks report</h1>');
    for (const heading of ["Names that couldn't be matched", 'Side note: in the register but not on the debrief', 'Administrators', 'Text wider than its box']) {
      expect(html).toContain(heading);
    }
    expect(html).toContain(`Total (4 people)</td><td class="n">${formatRand(result.totalCents)}`);
  });

  it('never puts a student number in the checks report or on a form', () => {
    const html = strFromU8(d.report.bytes);
    for (const number of ['200000001', '200000002', '200000003']) {
      expect(html).not.toContain(number);
      for (const f of d.forms) expect(Buffer.from(f.bytes).includes(number)).toBe(false);
    }
  });
});
