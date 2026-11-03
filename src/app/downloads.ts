// Everything the website hands back after a run: each person's claim
// form(s), the control list, the checks report, and all of it in one zip.
// No screens here, so the tests use exactly what the website uses.

import { strToU8, zipSync } from 'fflate';
import { MONTH_NAMES } from '../core/dates.ts';
import type { Settings } from '../core/settings.ts';
import { checksReportHtml } from '../out/checks-report.ts';
import { controlList } from '../out/control-list.ts';
import { fillClaimForm, firstOfNextMonth } from '../pdf/fill.ts';
import { controlListRows, type Check, type MonthResult } from '../run/month.ts';

export interface DownloadFile {
  fileName: string;
  bytes: Uint8Array;
  type: string;
}

export interface Downloads {
  /** The claim forms, one or two per SI Leader. */
  forms: DownloadFile[];
  controlList: DownloadFile;
  report: DownloadFile;
  /** All of the above in one file. */
  zip: DownloadFile;
  /** The month's checks plus anything found while filling the forms. */
  checks: Check[];
}

const PDF = 'application/pdf';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Fills everyone's forms from the kept blank HRM-05 and puts the downloads together. */
export async function makeDownloads(
  result: MonthResult,
  claimForm: Uint8Array,
  month: number,
  year: number,
  settings: Settings,
  submissionDate = firstOfNextMonth(month, year),
): Promise<Downloads> {
  const checks = [...result.checks];
  const forms: DownloadFile[] = [];
  for (const p of result.people) {
    if (!p.claim) continue; // administrators: no form until their lines are decided
    const who = p.person.formName;
    if (p.rateCents === null || p.amountCents === null) {
      checks.push({ section: 'levels', person: who, message: 'No form made: there is no rate.' });
      continue;
    }
    if (!p.claim.forms.length) {
      checks.push({ section: 'forms', person: who, message: 'No form made: the lines need your decision first.' });
      continue;
    }
    const filled = await fillClaimForm(
      claimForm,
      { formName: who, month, year, submissionDate, forms: p.claim.forms, totalMinutes: p.totalMinutes, rateCents: p.rateCents, amountCents: p.amountCents },
      settings,
    );
    for (const f of filled.files) forms.push({ fileName: f.fileName, bytes: f.bytes, type: PDF });
    for (const w of filled.warnings) checks.push({ section: w.includes('second form') ? 'forms' : 'form-text', person: who, message: w });
  }

  const label = `${MONTH_NAMES[month - 1]} ${year}`;
  const list: DownloadFile = { fileName: `Control list ${label}.xlsx`, bytes: controlList(controlListRows(result)), type: XLSX };
  const report: DownloadFile = { fileName: `Checks report ${label}.html`, bytes: strToU8(checksReportHtml(result, month, year, checks)), type: 'text/html' };
  const zip: DownloadFile = {
    fileName: `SI claims ${label}.zip`,
    bytes: zipSync(Object.fromEntries([...forms, list, report].map((f) => [f.fileName, [f.bytes, { level: f.type === PDF ? 0 : 6 }]]))),
    type: 'application/zip',
  };
  return { forms, controlList: list, report, zip, checks };
}
