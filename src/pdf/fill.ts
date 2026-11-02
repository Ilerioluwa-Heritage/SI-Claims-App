// Fills the HRM-05 claim form without changing the form itself (SI
// Administrator, 3 Nov 2026). The form's fonts, character sizes, colours,
// field names and settings stay exactly as they are:
//   - each value is written into its field, and drawn in the field's own
//     appearance, in the slot the form already has for it ("() Tj"), so it
//     shows in the form's own font, size, colour and position;
//   - the form's bytes are kept unchanged, and the filled values are added
//     after them as an update, the way PDF editors save a filled-in form.
// Nothing is shrunk to fit: a value too wide for its box is reported instead.
//
// POPIA: only the fields on WRITTEN below are ever filled. Cell number,
// student number, address, bank, account, branch, signatures, the approver
// row and the signature/date boxes are left blank and fillable.
//
// Works from the form's bytes and returns the filled files' bytes, so the
// website, the phone app and the tests share it. Nothing is written to disk.

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFString,
  PDFTextField,
  decodePDFRawStream,
  type PDFContext,
  type PDFForm,
  type PDFObject,
} from 'pdf-lib';
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

/** Every field this program may fill. Anything else on the form is left exactly as it is. */
export const WRITTEN: ReadonlySet<string> = new Set([
  ...Object.values(HEADER),
  ...Array.from({ length: 13 }, (_, i) => Object.values(lineFields(i + 1))).flat(),
]);

/** A field's name in plain words, for messages. */
function label(name: string): string {
  const header: Record<string, string> = {
    NAME_AND_SURNAME0: 'name', DATE0: 'date', NAME_OF_SCHOOL: 'school', COST_CENTER_NO: 'cost centre number',
    COST_CENTER_NAME: 'cost centre name', Textfield4: 'month', Textfield5: 'year', Textfield6: 'total hours',
    Textfield7: 'rate', Textfield8: 'amount', Textfield9: 'total hours', Textfield11: 'date signed',
    Textfield12: 'approver', Textfield13: 'approver number',
  };
  if (header[name]) return header[name];
  for (let n = 1; n <= 13; n++) {
    const part = Object.entries(lineFields(n)).find(([, f]) => f === name)?.[0];
    if (part) return `line ${n} ${{ date: 'date', programme: 'programme', service: 'service', timeIn: 'time in', timeOut: 'time out', hours: 'hours' }[part]}`;
  }
  return name;
}

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

export interface FilledForm {
  /** One file per page: "MABUNDA YP.pdf", then "MABUNDA YP (page 2).pdf" if the lines don't fit on one. */
  files: { fileName: string; bytes: Uint8Array }[];
  /** For the checks report, e.g. a value too wide for its box. */
  warnings: string[];
}

/** October 2026 -> "2026-11-01", the usual submission date. */
export function firstOfNextMonth(month: number, year: number): string {
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

/** "MABUNDA YP" -> "MABUNDA YP.pdf", without characters a file name can't hold. */
export function formFileName(formName: string): string {
  return `${formName.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()}.pdf`;
}

// ---------------------------------------------------------------------------
// Appearances: the form's own drawing of each field
// ---------------------------------------------------------------------------

const AP = PDFName.of('AP');
const N = PDFName.of('N');
const V = PDFName.of('V');

const latin1 = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');
const bytesOf = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);
/** Text for a PDF literal string: \ ( and ) escaped. */
const literal = (text: string) => text.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[\r\n]+/g, ' ');

/** A field's or widget's default appearance (font, size, colour), e.g. "/Cambria 10 Tf 0 g", with the PDF escapes undone. */
function defaultAppearance(dict: PDFDict): string | undefined {
  const da = dict.lookup(PDFName.of('DA'));
  return da instanceof PDFString || da instanceof PDFHexString ? da.decodeText() : undefined;
}

const TEXT_SLOT =/\((?:\\[\s\S]|[^\\)])*\)\s*Tj|<[0-9A-Fa-f\s]*>\s*Tj/;

/** The text an appearance stream shows (its "(...) Tj" parts), e.g. a leftover "AUGUST". */
export function shownText(content: string): string {
  return [...content.matchAll(/\(((?:\\[\s\S]|[^\\)])*)\)\s*Tj/g)].map((m) => m[1]!.replace(/\\([\\()])/g, '$1')).join('').trim();
}

function normalAppearance(form: PDFForm, widget: { dict: PDFDict }): { ref: PDFObject | undefined; stream: PDFRawStream | undefined } {
  const ap = widget.dict.lookupMaybe(AP, PDFDict);
  const ref = ap?.get(N);
  const stream = ref ? form.doc.context.lookup(ref) : undefined;
  return { ref, stream: stream instanceof PDFRawStream ? stream : undefined };
}

/** How many widgets draw with each appearance stream, so a shared one is never overwritten. */
function appearanceUses(form: PDFForm): Map<PDFRef, number> {
  const uses = new Map<PDFRef, number>();
  for (const f of form.getFields()) {
    for (const w of f.acroField.getWidgets()) {
      const { ref } = normalAppearance(form, w);
      if (ref instanceof PDFRef) uses.set(ref, (uses.get(ref) ?? 0) + 1);
    }
  }
  return uses;
}

/**
 * Puts `text` into the field's own appearance. Where the form has a text slot
 * ("() Tj") the text goes in it, keeping every other instruction (font, size,
 * colour, position, clipping) as the form has it. Without a slot, the text is
 * drawn with the field's own default appearance (DA).
 */
function drawInto(content: string, text: string, da: string, height: number): string {
  if (TEXT_SLOT.test(content)) return content.replace(TEXT_SLOT, `(${literal(text)}) Tj`);
  const size = Number(/([\d.]+)\s+Tf/.exec(da)?.[1]) || 10;
  const draw = `BT\n${da}\n2 ${((height - size) / 2 + size * 0.22).toFixed(3)} Td\n(${literal(text)}) Tj\nET\n`;
  const lastEMC = content.lastIndexOf('EMC');
  return lastEMC >= 0 ? `${content.slice(0, lastEMC)}${draw}${content.slice(lastEMC)}` : `/Tx BMC\n${draw}EMC\n`;
}

/** Width of `text` in the field's own font and size, from the font's character widths; null if unknown. */
function textWidth(text: string, da: string, fonts: PDFDict | undefined): number | null {
  const m = /\/([^\s/]+)\s+([\d.]+)\s+Tf/.exec(da);
  const font = m ? fonts?.lookupMaybe(PDFName.of(m[1]!), PDFDict) : undefined;
  const widths = font?.lookupMaybe(PDFName.of('Widths'), PDFArray);
  const first = font?.lookupMaybe(PDFName.of('FirstChar'), PDFNumber)?.asNumber() ?? 0;
  if (!widths || !m) return null;
  let total = 0;
  for (const ch of text) {
    const w = widths.lookupMaybe(ch.charCodeAt(0) - first, PDFNumber)?.asNumber();
    if (w === undefined) return null;
    total += w;
  }
  return (total * Number(m[2])) / 1000;
}

// ---------------------------------------------------------------------------
// Saving: the form's bytes unchanged, the filled values added after them
// ---------------------------------------------------------------------------

/** Appends the changed objects, a cross-reference section and a trailer to the original bytes. */
function appendUpdate(original: Uint8Array, context: PDFContext, changed: Map<PDFRef, PDFObject>): Uint8Array {
  const chunks: Uint8Array[] = [original];
  let offset = original.length;
  const add = (bytes: Uint8Array) => {
    chunks.push(bytes);
    offset += bytes.length;
  };
  const ascii = (text: string) => add(bytesOf(text));
  if (original[original.length - 1] !== 0x0a) ascii('\n');

  const written = [...changed].sort(([a], [b]) => a.objectNumber - b.objectNumber).map(([ref, obj]) => {
    const at = offset;
    ascii(`${ref.objectNumber} ${ref.generationNumber} obj\n`);
    const body = new Uint8Array(obj.sizeInBytes());
    obj.copyBytesInto(body, 0);
    add(body);
    ascii('\nendobj\n');
    return { ref, at };
  });

  const xrefAt = offset;
  let xref = 'xref\n';
  for (let i = 0; i < written.length; ) {
    let j = i;
    while (j + 1 < written.length && written[j + 1]!.ref.objectNumber === written[j]!.ref.objectNumber + 1) j++;
    xref += `${written[i]!.ref.objectNumber} ${j - i + 1}\n`;
    for (const { ref, at } of written.slice(i, j + 1)) xref += `${String(at).padStart(10, '0')} ${String(ref.generationNumber).padStart(5, '0')} n\r\n`;
    i = j + 1;
  }
  const tail = latin1(original.subarray(Math.max(0, original.length - 1024)));
  const prev = Number([...tail.matchAll(/startxref\s+(\d+)/g)].at(-1)?.[1]);
  if (!Number.isFinite(prev)) throw new Error("Can't find the end of the form's file (startxref).");
  const t = context.trailerInfo;
  const trailer = [
    `/Size ${context.largestObjectNumber + 1}`,
    `/Root ${t.Root}`,
    t.Info ? `/Info ${t.Info}` : '',
    t.ID ? `/ID ${t.ID}` : '',
    `/Prev ${prev}`,
  ].filter(Boolean);
  ascii(`${xref}trailer\n<< ${trailer.join(' ')} >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  const out = new Uint8Array(offset);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** One copy of the form with `values` filled in. Returns its bytes and the fields whose text is too wide for the box. */
async function fillOne(template: Uint8Array, values: Map<string, string>): Promise<{ bytes: Uint8Array; tooWide: string[] }> {
  const doc = await PDFDocument.load(template, { updateMetadata: false });
  const { context } = doc;
  const form = doc.getForm();
  const formDA = defaultAppearance(form.acroForm.dict);
  const fonts = form.acroForm.dict.lookupMaybe(PDFName.of('DR'), PDFDict)?.lookupMaybe(PDFName.of('Font'), PDFDict);
  const uses = appearanceUses(form);
  const changed = new Map<PDFRef, PDFObject>();
  const tooWide = new Set<string>();

  for (const [name, text] of values) {
    if (!WRITTEN.has(name)) throw new Error(`Refusing to fill ${name}: it isn't on the list of fields this program fills.`);
    const field = form.getTextField(name);
    const fieldRef = context.getObjectRef(field.acroField.dict);
    if (!fieldRef) throw new Error(`The form's ${label(name)} field can't be updated.`);
    field.acroField.dict.set(V, PDFString.of(literal(text)));
    changed.set(fieldRef, field.acroField.dict);

    for (const widget of field.acroField.getWidgets()) {
      const { ref, stream } = normalAppearance(form, widget);
      if (!stream) throw new Error(`The form's ${label(name)} box has no appearance to draw its text in.`);
      const da = defaultAppearance(widget.dict) ?? defaultAppearance(field.acroField.dict) ?? formDA ?? '';
      const bbox = stream.dict.lookupMaybe(PDFName.of('BBox'), PDFArray)?.asArray().map((n) => (n instanceof PDFNumber ? n.asNumber() : 0)) ?? [0, 0, 0, 0];
      const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = bbox;
      const width = textWidth(text, da, fonts);
      if (width !== null && width > x1 - x0 - 4) tooWide.add(name);

      const content = drawInto(latin1(decodePDFRawStream(stream).decode()), text, da, y1 - y0);
      const entries: Record<string, PDFObject> = {};
      for (const [k, v] of stream.dict.entries()) {
        if (!['/Length', '/Filter', '/DecodeParms'].includes(k.asString())) entries[k.asString().slice(1)] = v;
      }
      const fresh = context.stream(bytesOf(content), entries);
      if (ref instanceof PDFRef && uses.get(ref) === 1) {
        context.assign(ref, fresh);
        changed.set(ref, fresh);
      } else {
        // Shared or stored inside the widget: give this widget an appearance of its own.
        const apHolder = widget.dict.get(AP);
        const ap = widget.dict.lookup(AP, PDFDict);
        const freshRef = context.register(fresh);
        ap.set(N, freshRef);
        changed.set(freshRef, fresh);
        if (apHolder instanceof PDFRef) changed.set(apHolder, ap);
        else changed.set(context.getObjectRef(widget.dict) ?? fieldRef, widget.dict);
      }
    }
  }
  return { bytes: appendUpdate(template, context, changed), tooWide: [...tooWide] };
}

/** What goes in each field for one page of the claim. */
function valuesFor(content: FormContent, lines: ClaimRow[], settings: Settings): Map<string, string> {
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
  return values;
}

/**
 * The filled form for one person. Up to 13 lines fit on the form. More lines
 * go on another, untouched copy of the form in a second file (renaming its
 * fields to join the two into one file would change the form). Every copy
 * shows the claim's totals.
 */
export async function fillClaimForm(template: Uint8Array, content: FormContent, settings: Settings): Promise<FilledForm> {
  if (content.pages.some((p) => p.length > settings.rowsPerPage)) throw new Error(`A page can hold at most ${settings.rowsPerPage} lines.`);
  const pages = content.pages.length ? content.pages : [[]];
  const files: FilledForm['files'] = [];
  const warnings: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const values = valuesFor(content, pages[i]!, settings);
    const { bytes, tooWide } = await fillOne(template, values);
    const fileName = formFileName(i === 0 ? content.formName : `${content.formName} (page ${i + 1})`);
    files.push({ fileName, bytes });
    for (const name of tooWide) {
      warnings.push(`${fileName}: the ${label(name)} "${values.get(name)}" is wider than its box at the form's own font size, so part of it may be cut off.`);
    }
  }
  if (pages.length > 1) warnings.unshift(`${content.formName} has more lines than one form holds, so the claim continues on ${pages.length - 1} more form${pages.length > 2 ? 's' : ''}.`);
  return { files, warnings };
}

// ---------------------------------------------------------------------------
// Checking an uploaded blank form
// ---------------------------------------------------------------------------

/**
 * Checks an uploaded HRM-05 before it's kept: it must be a readable PDF with
 * every field this program fills, and blank, so nobody's personal details
 * can be carried into someone else's claim. Returns what's wrong, if anything.
 */
export async function checkClaimForm(bytes: Uint8Array): Promise<string[]> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    return [/encrypt/i.test(String(e)) ? 'The form is locked with a password; upload an unlocked copy.' : "This file can't be read as a PDF."];
  }
  const form = doc.getForm();
  const fields = new Map(form.getFields().map((f) => [f.getName(), f]));
  const problems: string[] = [];
  for (const name of WRITTEN) {
    const f = fields.get(name);
    if (!f) problems.push(`It has no field called ${name} (the ${label(name)}).`);
    else if (!(f instanceof PDFTextField)) problems.push(`Its ${name} field (the ${label(name)}) isn't a text box.`);
    else if (f.acroField.getWidgets().some((w) => !normalAppearance(form, w).stream)) problems.push(`Its ${name} field (the ${label(name)}) has no appearance to draw text in.`);
  }
  for (const [name, f] of fields) {
    if (WRITTEN.has(name) || !(f instanceof PDFTextField)) continue;
    const shown = f.acroField.getWidgets().map((w) => normalAppearance(form, w).stream).map((s) => (s ? shownText(latin1(decodePDFRawStream(s).decode())) : ''));
    if ((f.getText() ?? '') !== '' || shown.some(Boolean)) problems.push(`It isn't blank: ${name} already has something in it. Upload a blank copy.`);
  }
  return problems;
}
