// Fills the HRM-05 claim form. The result stays a fillable form: each SI
// Leader adds their own personal details and signature.
//
// POPIA: only the fields on WRITTEN below are ever filled. Cell number,
// student number, address, bank, account, branch, signatures, the approver
// row and the signature/date boxes are left blank and fillable.
//
// Works from the template's bytes and returns the filled file's bytes, so the
// website, the phone app and the tests share it. Nothing is written to disk.

import { PDFDict, PDFDocument, PDFName, PDFRef, StandardFonts, type PDFFont, type PDFTextField } from 'pdf-lib';
import { MONTH_NAMES } from '../core/dates.ts';
import { showHours } from '../core/editor.ts';
import { formatRand } from '../core/money.ts';
import { formatDates, type ClaimRow } from '../core/rules.ts';
import type { Settings } from '../core/settings.ts';

/**
 * Line n (1-13) on the form. The numbering is off by one: DATE1's row has no
 * box on the page, so line 1 is DATE2 with the "0" fields, line n is
 * DATE{n+1} with the "{n-1}" fields.
 */
export function lineFields(n: number) {
  const s = String(n - 1);
  return {
    date: `DATE${n + 1}`,
    programme: `NAME_OF_THE_PROGRAMME${s}`,
    service: `NATURE_OF_SERVICE_RENDERED${s}`,
    timeIn: `TIME_IN${s}`,
    timeOut: `TIME_OUT${s}`,
    hours: `HOURS_WORKED${s}`,
  };
}

const HEADER = {
  name: 'NAME_AND_SURNAME0',
  date: 'DATE0',
  school: 'NAME_OF_SCHOOL',
  costCentreNo: 'COST_CENTER_NO',
  costCentreName: 'COST_CENTER_NAME',
  month: 'Textfield4',
  year: 'Textfield5',
  hours: 'Textfield6',
  rate: 'Textfield7',
  amount: 'Textfield8',
  hoursAgain: 'Textfield9',
  dateSigned: 'Textfield11',
  approverName: 'Textfield12',
  approverNumber: 'Textfield13',
} as const;

/** Every field this program may fill. Anything else on the form is left as it is. */
export const WRITTEN: ReadonlySet<string> = new Set([
  ...Object.values(HEADER),
  ...Array.from({ length: 13 }, (_, i) => Object.values(lineFields(i + 1))).flat(),
]);

export interface FormContent {
  /** As printed on the form and in the file name, e.g. "MABUNDA YP". */
  formName: string;
  month: number;
  year: number;
  /** "YYYY-MM-DD"; usually the 1st of the next month (see firstOfNextMonth). */
  submissionDate: string;
  /** The lines, already split into pages of at most 13. */
  pages: ClaimRow[][];
  totalMinutes: number;
  rateCents: number;
  amountCents: number;
}

/** October 2026 -> "2026-11-01", the usual submission date. */
export function firstOfNextMonth(month: number, year: number): string {
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

/** "MABUNDA YP" -> "MABUNDA YP.pdf", without characters a file name can't hold. */
export function formFileName(formName: string): string {
  return `${formName.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()}.pdf`;
}

const SMALLEST_FONT = 5;

/** Writes one field and redraws only that field's appearance, shrinking the text to fit its box. */
function put(field: PDFTextField, text: string, font: PDFFont) {
  const widgets = field.acroField.getWidgets();
  const fieldDA = field.acroField.getDefaultAppearance();
  const width = Math.min(...widgets.map((w) => w.getRectangle().width));
  const sizeOf = (da: string | undefined) => Number(/([\d.]+)\s+Tf/.exec(da ?? '')?.[1]) || 10;
  const wanted = sizeOf(widgets[0]?.getDefaultAppearance() ?? fieldDA);
  // 4pt of padding inside the box, and a little room in case a viewer redraws it in its own font.
  const fits = text ? ((width - 4) * 0.95) / font.widthOfTextAtSize(text, 1) : wanted;
  const size = Math.max(SMALLEST_FONT, Math.min(wanted, Math.floor(fits * 10) / 10));
  const resize = (da: string) => da.replace(/([\d.]+)\s+Tf/, `${size} Tf`);
  // Some fields keep their font setting only on their widgets; give the field one too.
  field.acroField.setDefaultAppearance(resize(fieldDA ?? widgets[0]?.getDefaultAppearance() ?? '/Helv 10 Tf 0 g'));
  for (const w of widgets) {
    const da = w.getDefaultAppearance();
    if (da) w.setDefaultAppearance(resize(da));
  }
  field.setText(text);
  field.updateAppearances(font);
}

/** Fills one copy of the form (one page). `suffix` renames its fields, e.g. "_p2" on a continuation page. */
async function fillPage(template: Uint8Array, content: FormContent, lines: ClaimRow[], suffix: string, settings: Settings) {
  const doc = await PDFDocument.load(template, { updateMetadata: false });
  const form = doc.getForm();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  if (suffix) for (const f of form.getFields()) f.acroField.setPartialName(f.getName() + suffix);

  const values = new Map<string, string>([
    [HEADER.name, content.formName],
    [HEADER.date, formatDates([content.submissionDate])],
    [HEADER.school, settings.schoolName],
    [HEADER.costCentreNo, settings.costCentreNo],
    [HEADER.costCentreName, settings.costCentreName],
    [HEADER.month, MONTH_NAMES[content.month - 1] ?? ''],
    [HEADER.year, String(content.year)],
    [HEADER.hours, showHours(content.totalMinutes)],
    [HEADER.rate, formatRand(content.rateCents)],
    [HEADER.amount, formatRand(content.amountCents)],
    [HEADER.hoursAgain, showHours(content.totalMinutes)],
    [HEADER.dateSigned, formatDates([content.submissionDate])],
    [HEADER.approverName, settings.signatoryName],
    [HEADER.approverNumber, settings.signatoryPersonnelNo],
  ]);
  lines.forEach((row, i) => {
    const f = lineFields(i + 1);
    values.set(f.date, formatDates(row.dates));
    values.set(f.programme, settings.programmeName);
    values.set(f.service, row.service);
    values.set(f.timeIn, row.timeIn);
    values.set(f.timeOut, row.timeOut);
    values.set(f.hours, showHours(row.minutes));
  });

  for (const [name, text] of values) {
    if (!WRITTEN.has(name)) throw new Error(`Refusing to fill ${name}: it isn't on the list of fields this program fills.`);
    put(form.getTextField(name + suffix), text, font);
  }
  return doc;
}

/**
 * The filled form for one person. Up to 13 lines go on one page; more go on
 * continuation pages, each a full copy of the form showing the claim's totals,
 * with its field names ending in "_p2", "_p3"... so a viewer doesn't copy what's
 * typed on page 1 into them.
 */
export async function fillClaimForm(template: Uint8Array, content: FormContent, settings: Settings): Promise<Uint8Array> {
  if (content.pages.some((p) => p.length > settings.rowsPerPage)) throw new Error(`A page can hold at most ${settings.rowsPerPage} lines.`);
  const pages = content.pages.length ? content.pages : [[]];
  const out = await fillPage(template, content, pages[0]!, '', settings);

  for (let i = 1; i < pages.length; i++) {
    const extra = await fillPage(template, content, pages[i]!, `_p${i + 1}`, settings);
    // Widgets point back at their own page (/P); drop that so copying doesn't drag a stray page along.
    for (const f of extra.getForm().getFields()) for (const w of f.acroField.getWidgets()) w.dict.delete(PDFName.of('P'));
    const [page] = await out.copyPages(extra, [0]);
    out.addPage(page!);
    // Register the copied fields with the form so they stay fillable.
    const annots = page!.node.Annots();
    const tops = new Set<PDFRef>();
    for (let j = 0; j < (annots?.size() ?? 0); j++) {
      let ref = annots!.get(j);
      let dict = out.context.lookup(ref);
      while (dict instanceof PDFDict && dict.get(PDFName.of('Parent')) instanceof PDFRef) {
        ref = dict.get(PDFName.of('Parent'))!;
        dict = out.context.lookup(ref);
      }
      if (ref instanceof PDFRef && dict instanceof PDFDict && dict.has(PDFName.of('T'))) tops.add(ref);
    }
    for (const ref of tops) out.getForm().acroForm.addField(ref);
  }
  // Appearances were drawn field by field above; don't let pdf-lib redraw the whole form.
  return out.save({ updateFieldAppearances: false });
}
