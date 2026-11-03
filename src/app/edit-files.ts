// The claim form editor's download: the uploaded form with the changes
// written in. Only if the lines no longer fit on one form is a second form
// made, from the kept blank HRM-05. No screens here, so the tests use exactly
// what the website uses.

import { recalculate, type EditableClaim } from '../core/editor.ts';
import type { Settings } from '../core/settings.ts';
import { rewriteClaimForm } from '../pdf/fill.ts';
import type { DownloadFile } from './downloads.ts';

export async function saveEditedForm(
  original: { fileName: string; bytes: Uint8Array },
  claim: EditableClaim,
  blankForm: Uint8Array | null,
  settings: Settings,
): Promise<{ files: DownloadFile[]; warnings: string[] } | { error: string }> {
  const r = recalculate(claim, settings);
  if (!claim.month || !claim.year) return { error: 'Say which month the form is for first, e.g. "the month is October 2026".' };
  if (claim.rateCents === null || r.amountCents === null) return { error: 'Set the rate first, e.g. "set the rate to R36.50" or "set the level to Honours".' };
  if (!r.forms.length) return { error: "The lines don't fit even on two forms. Remove or combine some first." };
  if (r.forms.length > 1 && !blankForm) {
    return { error: 'These lines need a second form. Upload the blank HRM-05 (Monthly claims, step 2) so it can be made.' };
  }

  const base = original.fileName.replace(/\.pdf$/i, '');
  const files: DownloadFile[] = [];
  const warnings: string[] = [];
  for (let i = 0; i < r.forms.length; i++) {
    const fileName = i === 0 ? original.fileName : `${base} (form ${i + 1}).pdf`;
    const { bytes, warnings: w } = await rewriteClaimForm(
      i === 0 ? original.bytes : blankForm!,
      { formName: claim.name ?? null, month: claim.month, year: claim.year, rows: r.forms[i]!, totalMinutes: r.totalMinutes, rateCents: claim.rateCents, amountCents: r.amountCents },
      settings,
    );
    files.push({ fileName, bytes, type: 'application/pdf' });
    warnings.push(...w.map((m) => `${fileName}: ${m}`));
  }
  return { files, warnings };
}
