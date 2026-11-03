import { readFileSync } from 'node:fs';
import { PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { demoMonth } from '../src/app/demo.ts';
import { makeDownloads } from '../src/app/downloads.ts';
import { saveEditedForm } from '../src/app/edit-files.ts';
import { DEFAULT_SETTINGS as S, claimFromForm, editClaim, formatRand, recalculate, type EditResult, type EditableClaim } from '../src/core/index.ts';
import { lineFields, readClaimForm } from '../src/pdf/fill.ts';
import { runMonth } from '../src/run/month.ts';

const BLANK = new Uint8Array(readFileSync('tests/fixtures/HRM-05 blank.pdf'));
const SLOW = 120_000;
const ok = (r: EditResult | { error: string }) => {
  if ('error' in r) throw new Error(r.error);
  return r;
};

/** A form as an SI Leader would hand it in: filled by the app, then their own details typed in (made-up). */
async function submittedForm() {
  const d = await makeDownloads(runMonth(demoMonth(), S), BLANK, 10, 2026, S);
  const doc = await PDFDocument.load(d.forms[0]!.bytes);
  doc.getForm().getTextField('CELL_NO0').setText('0820000000');
  doc.getForm().getTextField('UL_STUDENT_NUMBER').setText('200000001');
  return { fileName: d.forms[0]!.fileName, bytes: await doc.save() };
}

async function fields(bytes: Uint8Array) {
  const form = (await PDFDocument.load(bytes)).getForm();
  return (name: string) => form.getTextField(name).getText() ?? '';
}

describe('the claim form editor, on an uploaded form', () => {
  let uploaded: { fileName: string; bytes: Uint8Array };
  let claim: EditableClaim;
  beforeAll(async () => {
    uploaded = await submittedForm();
    const read = await readClaimForm(uploaded.bytes);
    if ('problems' in read) throw new Error(read.problems.join(' '));
    claim = claimFromForm(read.text).claim;
  }, SLOW);

  it('reads only the boxes it fills, never the SI Leader\'s own details', async () => {
    const read = await readClaimForm(uploaded.bytes);
    expect(JSON.stringify(read)).not.toContain('0820000000');
    expect(JSON.stringify(read)).not.toContain('200000001');
    expect(claim).toMatchObject({ name: 'EXAMPLE AB', month: 10, year: 2026, rateCents: 3650 });
    expect(claim.rows).toHaveLength(6);
  });

  it('writes a change back: the line goes, the rest move up, the totals are worked out again', async () => {
    const edited = ok(editClaim(claim, 'remove the session of the 7th', S)).claim;
    const saved = await saveEditedForm(uploaded, edited, BLANK, S);
    if ('error' in saved) throw new Error(saved.error);
    expect(saved.files.map((f) => f.fileName)).toEqual(['EXAMPLE AB.pdf']);
    const after = await fields(saved.files[0]!.bytes);
    const r = recalculate(edited, S);
    expect([after('Textfield6'), after('Textfield9'), after('Textfield8')]).toEqual(['19', '19', formatRand(r.amountCents!)]);
    expect([3, 4, 5, 6].map((n) => after(lineFields(n).date))).toEqual(['14/10/2026', '21/10/2026', '05/10/2026', '']); // 07/10 gone, the class moves up, line 6 now blank
    expect(after(lineFields(6).hours)).toBe('');
  }, SLOW);

  it('keeps the uploaded form as it was: its bytes, and the SI Leader\'s own details', async () => {
    const saved = await saveEditedForm(uploaded, ok(editClaim(claim, 'remove line 1', S)).claim, BLANK, S);
    if ('error' in saved) throw new Error(saved.error);
    const bytes = saved.files[0]!.bytes;
    expect(Buffer.from(bytes.subarray(0, uploaded.bytes.length)).equals(Buffer.from(uploaded.bytes))).toBe(true);
    const after = await fields(bytes);
    expect([after('CELL_NO0'), after('UL_STUDENT_NUMBER'), after('NAME_AND_SURNAME0')]).toEqual(['0820000000', '200000001', 'EXAMPLE AB']);
  }, SLOW);

  it('makes a second form from the kept blank form only when the lines no longer fit', async () => {
    let edited = claim;
    const hh = (n: number) => String(n).padStart(2, '0');
    // Nine more sessions at different times: 15 lines. Combining joins only 14/10 and 21/10 (both
    // 14H00-17H00, already on the form), leaving 14, so the claim needs a second form.
    for (let d = 15; d <= 23; d++) edited = ok(editClaim(edited, `add a session on ${d}/10 from ${hh(d - 10)}H00 to ${hh(d - 9)}H00`, S)).claim;
    expect(recalculate(edited, S).forms.map((f) => f.length)).toEqual([13, 1]);
    const saved = await saveEditedForm(uploaded, edited, BLANK, S);
    if ('error' in saved) throw new Error(saved.error);
    expect(saved.files.map((f) => f.fileName)).toEqual(['EXAMPLE AB.pdf', 'EXAMPLE AB (form 2).pdf']);
    const second = await fields(saved.files[1]!.bytes);
    expect([second('NAME_AND_SURNAME0'), second(lineFields(1).date), second('CELL_NO0')]).toEqual(['EXAMPLE AB', '05/10/2026', '']);
    expect(await saveEditedForm(uploaded, edited, null, S)).toEqual({ error: 'These lines need a second form. Upload the blank HRM-05 (Monthly claims, step 2) so it can be made.' });
  }, SLOW);

  it('works on a blank form once it has a month, rate and name', async () => {
    const read = await readClaimForm(BLANK);
    if ('problems' in read) throw new Error(read.problems.join(' '));
    let c = claimFromForm(read.text).claim;
    expect(await saveEditedForm({ fileName: 'blank.pdf', bytes: BLANK }, c, BLANK, S)).toEqual({ error: 'Say which month the form is for first, e.g. "the month is October 2026".' });
    for (const command of ['the month is October 2026', 'set the level to Honours', 'the name is Sample CD', 'add a session on the 5th from 14H00 to 15H00']) c = ok(editClaim(c, command, S)).claim;
    const saved = await saveEditedForm({ fileName: 'SAMPLE CD.pdf', bytes: BLANK }, c, BLANK, S);
    if ('error' in saved) throw new Error(saved.error);
    const after = await fields(saved.files[0]!.bytes);
    expect(['NAME_AND_SURNAME0', 'Textfield4', 'Textfield7', 'Textfield8', 'NAME_OF_SCHOOL', 'DATE0', lineFields(1).date].map(after)).toEqual([
      'SAMPLE CD', 'OCTOBER', 'R47.00', 'R141.00', 'CAE (SI)', '01/11/2026', '05/10/2026',
    ]);
  }, SLOW);

  it("draws text into a box that has no drawing of its own, with the box's own font setting", async () => {
    // PDF programs often save empty boxes without a drawing; here line 2's date box has none.
    const doc = await PDFDocument.load(uploaded.bytes);
    for (const w of doc.getForm().getTextField(lineFields(2).date).acroField.getWidgets()) w.dict.delete(PDFName.of('AP'));
    const stripped = await doc.save({ updateFieldAppearances: false });
    const saved = await saveEditedForm({ fileName: 'EXAMPLE AB.pdf', bytes: stripped }, claim, BLANK, S);
    if ('error' in saved) throw new Error(saved.error);
    const after = await PDFDocument.load(saved.files[0]!.bytes);
    const field = after.getForm().getTextField(lineFields(2).date);
    const n = field.acroField.getWidgets()[0]!.dict.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'));
    const drawing = n instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(n).decode()).toString('latin1') : '';
    expect([field.getText(), drawing.includes('/Cambria 10 Tf'), drawing.includes('(02/10/2026) Tj')]).toEqual(['02/10/2026', true, true]);
  }, SLOW);

  it('refuses a file that is not the claim form', async () => {
    expect(await readClaimForm(new TextEncoder().encode('not a pdf'))).toEqual({ problems: ["This file can't be read as a PDF."] });
  });
});
