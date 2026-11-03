import { readFileSync } from 'node:fs';
import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFTextField, decodePDFRawStream, type PDFWidgetAnnotation } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS as S, buildSilClaim, claimFromForm, parseRand, parseTime, recalculate, type SiSession } from '../src/core/index.ts';
import { WRITTEN, checkClaimForm, fillClaimForm, firstOfNextMonth, formFileName, lineFields, type FormContent } from '../src/pdf/fill.ts';

const TEMPLATE = new Uint8Array(readFileSync('tests/fixtures/HRM-05 blank.pdf'));
const SLOW = 120_000; // a 1.8 MB form, read once per copy

// A made-up SI Leader's month.
const t = (s: string) => parseTime(s)!;
const session = (d: number, start: string, end: string): SiSession => ({ date: `2026-10-${String(d).padStart(2, '0')}`, start: t(start), end: t(end) });
function content(sessions: SiSession[], classes: { date: string; module: string; start: number }[] = []): FormContent {
  const claim = buildSilClaim({ sessions, classes, rateCents: parseRand('36.50') }, S);
  return {
    formName: 'EXAMPLE AB',
    month: 10,
    year: 2026,
    submissionDate: firstOfNextMonth(10, 2026),
    rows: claim.rows,
    totalMinutes: claim.totalMinutes,
    rateCents: claim.rateCents,
    amountCents: claim.amountCents,
  };
}

const appearance = (doc: PDFDocument, w: PDFWidgetAnnotation) => {
  const n = w.dict.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'));
  return n instanceof PDFRawStream ? Array.from(decodePDFRawStream(n).decode(), (b) => String.fromCharCode(b)).join('') : '';
};

/** Everything about a form that must not change: per field, its type, flags, font setting, boxes and look. */
async function describeForm(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();
  const fields = new Map(
    form.getFields().map((f) => [
      f.getName(),
      {
        text: f instanceof PDFTextField ? (f.getText() ?? '') : '',
        settings: [f.constructor.name, f.acroField.getFlags(), f.acroField.dict.get(PDFName.of('DA'))?.toString() ?? '', f.acroField.dict.get(PDFName.of('TU'))?.toString() ?? ''].join(' | '),
        widgets: f.acroField.getWidgets().map((w) => ({
          box: [w.getRectangle(), w.getDefaultAppearance(), w.dict.get(PDFName.of('F'))?.toString()],
          look: appearance(doc, w),
        })),
      },
    ]),
  );
  const acroForm = ['DA', 'DR', 'NeedAppearances'].map((k) => form.acroForm.dict.get(PDFName.of(k))?.toString());
  return { doc, fields, acroForm, value: (name: string) => fields.get(name)?.text ?? '' };
}

const PERSONAL = ['CELL_NO0', 'UL_STUDENT_NUMBER', 'Textfield', 'Textfield0', 'Textfield1', 'Textfield2', 'Textfield3', 'Textfield10', 'Textfield14', 'Textfield15', 'Textfield16', 'Textfield17', 'Textfield18', 'Textfield19'];

describe('filling the HRM-05 without changing the form', () => {
  let blank: Awaited<ReturnType<typeof describeForm>>;
  let filled: Awaited<ReturnType<typeof describeForm>>;
  let bytes: Uint8Array;
  let warnings: string[];
  beforeAll(async () => {
    const month = content(
      [session(2, '14:10', '15:50'), session(7, '18:15', '19:45'), session(9, '20:00', '22:20'), session(14, '14:00', '15:00'), session(21, '14:05', '15:10')],
      [{ date: '2026-10-06', module: 'MATH101', start: t('07:40') }, { date: '2026-10-06', module: 'STAT102', start: t('14:00') }],
    );
    const result = await fillClaimForm(TEMPLATE, month, S);
    expect(result.fileName).toBe('EXAMPLE AB.pdf');
    bytes = result.bytes;
    warnings = result.warnings;
    [blank, filled] = await Promise.all([describeForm(TEMPLATE), describeForm(bytes)]);
  }, SLOW);

  it("keeps the form's own file byte for byte; the values are added after it", () => {
    expect(bytes.length).toBeGreaterThan(TEMPLATE.length);
    expect(Buffer.from(bytes.subarray(0, TEMPLATE.length)).equals(Buffer.from(TEMPLATE))).toBe(true);
  });

  it('changes no font, character size, colour, field name, box or setting', () => {
    expect([...filled.fields.keys()]).toEqual([...blank.fields.keys()]);
    expect(filled.acroForm).toEqual(blank.acroForm);
    for (const [name, f] of blank.fields) {
      const after = filled.fields.get(name)!;
      expect([name, after.settings, after.widgets.map((w) => w.box)]).toEqual([name, f.settings, f.widgets.map((w) => w.box)]);
    }
    expect(filled.doc.getPageCount()).toBe(1);
  });

  it("draws each value with the box's own appearance: the form's drawing, with the text in its slot", () => {
    for (const name of ['NAME_AND_SURNAME0', 'COST_CENTER_NO', 'DATE2', 'TIME_IN5', 'HOURS_WORKED0', 'Textfield8']) {
      const before = blank.fields.get(name)!.widgets[0]!.look;
      const after = filled.fields.get(name)!.widgets[0]!.look;
      expect(after).toBe(before.replace(/\(\)\s*Tj/, `(${filled.value(name)}) Tj`));
    }
    // The month box's leftover "AUGUST" is replaced in both of its widgets.
    expect(filled.fields.get('Textfield4')!.widgets.map((w) => w.look)).toEqual(blank.fields.get('Textfield4')!.widgets.map((w) => w.look.replace('(AUGUST) Tj', '(OCTOBER) Tj')));
  });

  it('fills the header and totals', () => {
    expect(
      ['NAME_AND_SURNAME0', 'DATE0', 'NAME_OF_SCHOOL', 'COST_CENTER_NO', 'COST_CENTER_NAME', 'Textfield4', 'Textfield5', 'Textfield6', 'Textfield7', 'Textfield8', 'Textfield9', 'Textfield11', 'Textfield12', 'Textfield13'].map(filled.value),
    ).toEqual(['EXAMPLE AB', '01/11/2026', 'CAE (SI)', 'G082', 'UCDP STUDENT S & A', 'OCTOBER', '2026', '25.5', 'R36.50', 'R930.75', '25.5', '01/11/2026', 'PROF O CHABAYA', '9951504']);
  });

  it('fills the lines in order, on the right rows (DATE2 with the "0" fields)', () => {
    const row = (n: number) => Object.values(lineFields(n)).map(filled.value).join(' | ');
    expect([1, 2, 3, 4, 5, 6, 7].map(row)).toEqual([
      '02/10/2026 | SI PROGRAMME | SI SESSION | 14H00 | 19H00 | 5',
      '07/10/2026 | SI PROGRAMME | SI SESSION | 18H00 | 23H00 | 5',
      '09/10/2026 | SI PROGRAMME | SI SESSION | 18H00 | 23H30 | 5.5',
      '14/10/2026 | SI PROGRAMME | SI SESSION | 14H00 | 17H00 | 3',
      '21/10/2026 | SI PROGRAMME | SI SESSION | 14H00 | 17H00 | 3',
      '06/10/2026 | SI PROGRAMME | CLASS ATTENDANCE | 07H40/14H00 | 09H40/16H00 | 4',
      ' |  |  |  |  | ',
    ]);
    expect(filled.value('DATE1')).toBe(''); // the row with no box on the page
  });

  it('leaves every personal field exactly as it was: blank, fillable, same look', async () => {
    const doc = await PDFDocument.load(bytes);
    for (const name of PERSONAL) {
      const field = doc.getForm().getTextField(name);
      expect([name, field.getText() ?? '', field.isReadOnly(), filled.fields.get(name)!.widgets]).toEqual([name, '', false, blank.fields.get(name)!.widgets]);
    }
  });

  it('fills nothing outside its list', () => {
    const changed = [...filled.fields].filter(([name, f]) => JSON.stringify(f) !== JSON.stringify(blank.fields.get(name))).map(([name]) => name);
    expect(changed.filter((n) => !WRITTEN.has(n))).toEqual([]);
  });

  it('warns only about what is too wide: two classes on one day ("07H40/14H00") overflow the time boxes', () => {
    expect(warnings).toEqual([
      'EXAMPLE AB.pdf: the line 6 time in "07H40/14H00" is wider than its box at the form\'s own font size, so part of it may be cut off.',
      'EXAMPLE AB.pdf: the line 6 time out "09H40/16H00" is wider than its box at the form\'s own font size, so part of it may be cut off.',
    ]);
  });

  it('reads back to the same claim (what the editor will do with an uploaded form)', () => {
    const lines = Array.from({ length: 13 }, (_, i) => lineFields(i + 1))
      .map((f) => ({ date: filled.value(f.date), service: filled.value(f.service), timeIn: filled.value(f.timeIn), timeOut: filled.value(f.timeOut), hours: filled.value(f.hours) }))
      .filter((l) => l.date);
    const { claim, problems } = claimFromForm({ month: filled.value('Textfield4'), year: filled.value('Textfield5'), rate: filled.value('Textfield7'), lines });
    expect(problems).toEqual([]);
    const r = recalculate(claim, S);
    expect([r.totalMinutes / 60, r.amountCents, r.warnings]).toEqual([25.5, 93075, []]);
  });
});

describe('values that do not fit, and claims longer than the form', () => {
  it('reports a value too wide for its box, and keeps the form\'s font size', async () => {
    const long = content([session(7, '18:00', '20:00')]);
    long.rows = [{ dates: ['2026-10-07', '2026-10-08', '2026-10-21'], service: 'SI SESSION', timeIn: '18H00', timeOut: '22H00', minutes: 720 }];
    const result = await fillClaimForm(TEMPLATE, long, S);
    expect(result.warnings).toEqual([
      'EXAMPLE AB.pdf: the line 1 date "07&08&21/10/2026" is wider than its box at the form\'s own font size, so part of it may be cut off.',
    ]);
    const after = await describeForm(result.bytes);
    // The form's own setting, "/Cambria 10 Tf 0 g", exactly as it was (PDF escapes and all).
    expect(after.fields.get('DATE2')!.widgets[0]!.box[1]).toBe('\\057Cambria\\04010\\040Tf\\0400\\040g');
  }, SLOW);

  it('never makes a second form: a claim still over 13 lines after combining is refused', async () => {
    const at = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    const c = content(Array.from({ length: 15 }, (_, i) => session(i + 1, at(7 * 60 + i * 30), at(8 * 60 + i * 30))));
    expect(c.rows).toHaveLength(15);
    await expect(fillClaimForm(TEMPLATE, c, S)).rejects.toThrow(
      "EXAMPLE AB's claim has 15 lines, even after combining lines with the same times; the form holds 13. Decide which lines to change (for example in the claim form editor) before filling the form.",
    );
  });
});

describe('checking an uploaded blank form', () => {
  it('accepts the blank HRM-05', async () => {
    expect(await checkClaimForm(TEMPLATE)).toEqual([]);
  }, SLOW);

  it("refuses a file that isn't a PDF", async () => {
    expect(await checkClaimForm(new TextEncoder().encode('not a pdf'))).toEqual(["This file can't be read as a PDF."]);
  });

  it("refuses a form that isn't blank, so nobody's details are carried into another claim", async () => {
    const doc = await PDFDocument.load(TEMPLATE);
    doc.getForm().getTextField('CELL_NO0').setText('0820000000');
    expect(await checkClaimForm(await doc.save())).toEqual(["It isn't blank: CELL_NO0 already has something in it. Upload a blank copy."]);
  }, SLOW);

  it('refuses a form missing a box it fills', async () => {
    const doc = await PDFDocument.load(TEMPLATE);
    doc.getForm().getTextField('Textfield8').acroField.setPartialName('AMOUNT');
    expect(await checkClaimForm(await doc.save())).toEqual(['It has no field called Textfield8 (the amount).']);
  }, SLOW);
});

describe('names and dates', () => {
  it('submits on the 1st of the next month, and names the file after the person', () => {
    expect([firstOfNextMonth(10, 2026), firstOfNextMonth(12, 2026)]).toEqual(['2026-11-01', '2027-01-01']);
    expect(formFileName('MABUNDA YP')).toBe('MABUNDA YP.pdf');
    expect(formFileName('O/NEIL: AB')).toBe('O NEIL AB.pdf');
  });
});
