import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFRawStream, PDFTextField, decodePDFRawStream } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS as S, buildSilClaim, claimFromForm, parseRand, parseTime, recalculate, type SiSession } from '../src/core/index.ts';
import { WRITTEN, fillClaimForm, firstOfNextMonth, formFileName, lineFields, type FormContent } from '../src/pdf/fill.ts';

const TEMPLATE = new Uint8Array(readFileSync('templates/HRM-05 blank.pdf'));
const SLOW = 120_000; // a 1.8 MB template, loaded once per page

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
    pages: claim.pages,
    totalMinutes: claim.totalMinutes,
    rateCents: claim.rateCents,
    amountCents: claim.amountCents,
  };
}

async function open(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const fields = doc.getForm().getFields().filter((f): f is PDFTextField => f instanceof PDFTextField);
  const value = (name: string) => fields.find((f) => f.getName() === name)?.getText() ?? '';
  return { doc, fields, value };
}

/** The text a field's appearance actually draws (what you see on screen and on paper). */
function drawnText(field: PDFTextField): string {
  const ap = field.acroField.getWidgets()[0]!.dict.lookup(PDFName.of('AP'));
  const normal = ap instanceof Object && 'lookup' in ap ? (ap as { lookup(n: PDFName): unknown }).lookup(PDFName.of('N')) : undefined;
  if (!(normal instanceof PDFRawStream)) return '';
  const ops = new TextDecoder('latin1').decode(decodePDFRawStream(normal).decode());
  return [...ops.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)].map((m) => m[1]!.replace(/../g, (h) => String.fromCharCode(parseInt(h, 16)))).join('');
}

const PERSONAL = ['CELL_NO0', 'UL_STUDENT_NUMBER', 'Textfield', 'Textfield0', 'Textfield1', 'Textfield2', 'Textfield3', 'Textfield10', 'Textfield14', 'Textfield15', 'Textfield16', 'Textfield17', 'Textfield18', 'Textfield19'];

describe('filling the HRM-05', () => {
  let one: Awaited<ReturnType<typeof open>>;
  beforeAll(async () => {
    const month = content(
      [session(2, '14:10', '15:50'), session(7, '18:15', '19:45'), session(9, '20:00', '22:20'), session(14, '14:00', '15:00'), session(21, '14:05', '15:10')],
      [{ date: '2026-10-06', module: 'MATH101', start: t('07:40') }, { date: '2026-10-06', module: 'STAT102', start: t('14:00') }],
    );
    one = await open(await fillClaimForm(TEMPLATE, month, S));
  }, SLOW);

  it('fills the header and totals', () => {
    expect(
      ['NAME_AND_SURNAME0', 'DATE0', 'NAME_OF_SCHOOL', 'COST_CENTER_NO', 'COST_CENTER_NAME', 'Textfield4', 'Textfield5', 'Textfield6', 'Textfield7', 'Textfield8', 'Textfield9', 'Textfield11', 'Textfield12', 'Textfield13'].map(one.value),
    ).toEqual(['EXAMPLE AB', '01/11/2026', 'CAE (SI)', 'G082', 'UCDP STUDENT S & A', 'OCTOBER', '2026', '25.5', 'R36.50', 'R930.75', '25.5', '01/11/2026', 'PROF O CHABAYA', '9951504']);
  });

  it('fills the lines in order, on the right rows (DATE2 with the "0" fields)', () => {
    const row = (n: number) => Object.values(lineFields(n)).map(one.value).join(' | ');
    expect([1, 2, 3, 4, 5, 6, 7].map(row)).toEqual([
      '02/10/2026 | SI PROGRAMME | SI SESSION | 14H00 | 19H00 | 5',
      '07/10/2026 | SI PROGRAMME | SI SESSION | 18H00 | 23H00 | 5',
      '09/10/2026 | SI PROGRAMME | SI SESSION | 18H00 | 23H30 | 5.5',
      '14/10/2026 | SI PROGRAMME | SI SESSION | 14H00 | 17H00 | 3',
      '21/10/2026 | SI PROGRAMME | SI SESSION | 14H00 | 17H00 | 3',
      '06/10/2026 | SI PROGRAMME | CLASS ATTENDANCE | 07H40/14H00 | 09H40/16H00 | 4',
      ' |  |  |  |  | ',
    ]);
    expect(one.value('DATE1')).toBe(''); // the row with no box on the page
  });

  it('leaves every personal field blank and still fillable', () => {
    for (const name of PERSONAL) {
      const field = one.fields.find((f) => f.getName() === name)!;
      expect([name, field.getText() ?? '', field.isReadOnly()]).toEqual([name, '', false]);
    }
  });

  it('fills nothing outside its list', () => {
    const filled = one.fields.filter((f) => (f.getText() ?? '') !== '').map((f) => f.getName());
    expect(filled.filter((n) => !WRITTEN.has(n))).toEqual([]);
  });

  it('draws each value it fills, so it shows on screen and on paper', () => {
    for (const name of ['NAME_AND_SURNAME0', 'Textfield4', 'Textfield8', 'DATE2', 'TIME_IN5']) {
      const field = one.fields.find((f) => f.getName() === name)!;
      expect(drawnText(field)).toBe(field.getText());
    }
  });

  it('shrinks text that would not fit its box', async () => {
    const long = content([session(7, '18:00', '20:00')]);
    long.pages = [[{ dates: ['2026-10-07', '2026-10-08', '2026-10-21'], service: 'SI SESSION', timeIn: '18H00', timeOut: '22H00', minutes: 720 }]];
    const { fields } = await open(await fillClaimForm(TEMPLATE, long, S));
    const date = fields.find((f) => f.getName() === 'DATE2')!;
    expect(date.getText()).toBe('07&08&21/10/2026');
    const size = Number(/([\d.]+)\s+Tf/.exec(date.acroField.getWidgets()[0]!.getDefaultAppearance() ?? '')?.[1]);
    expect(size).toBeLessThan(10);
    expect(size).toBeGreaterThanOrEqual(5);
  }, SLOW);

  it('reads back to the same claim (what the editor will do with an uploaded form)', () => {
    const lines = Array.from({ length: 13 }, (_, i) => lineFields(i + 1))
      .map((f) => ({ date: one.value(f.date), service: one.value(f.service), timeIn: one.value(f.timeIn), timeOut: one.value(f.timeOut), hours: one.value(f.hours) }))
      .filter((l) => l.date);
    const { claim, problems } = claimFromForm({ month: one.value('Textfield4'), year: one.value('Textfield5'), rate: one.value('Textfield7'), lines });
    expect(problems).toEqual([]);
    const r = recalculate(claim, S);
    expect([r.totalMinutes / 60, r.amountCents, r.warnings]).toEqual([25.5, 93075, []]);
  });
});

describe('more than 13 lines', () => {
  it('continues on a second page with its own fields, showing the same totals', async () => {
    // 15 sessions at different times can't be combined: 13 on page 1, 2 on page 2.
    const at = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    const sessions = Array.from({ length: 15 }, (_, i) => session(i + 1, at(7 * 60 + i * 30), at(8 * 60 + i * 30)));
    const c = content(sessions);
    expect(c.pages.map((p) => p.length)).toEqual([13, 2]);
    const { doc, value, fields } = await open(await fillClaimForm(TEMPLATE, c, S));
    expect(doc.getPageCount()).toBe(2);
    expect([value('DATE2'), value('DATE14'), value('DATE2_p2'), value('DATE3_p2'), value('DATE4_p2')]).toEqual(['01/10/2026', '13/10/2026', '14/10/2026', '15/10/2026', '']);
    expect([value('Textfield8'), value('Textfield8_p2'), value('NAME_AND_SURNAME0_p2')]).toEqual([value('Textfield8'), value('Textfield8'), 'EXAMPLE AB']);
    const p2 = fields.find((f) => f.getName() === 'UL_STUDENT_NUMBER_p2')!;
    expect([p2.getText() ?? '', p2.isReadOnly()]).toEqual(['', false]);
  }, SLOW);

  it('refuses a page with more lines than the form holds', async () => {
    const c = content([session(1, '14:00', '15:00')]);
    c.pages = [Array.from({ length: 14 }, () => c.pages[0]![0]!)];
    await expect(fillClaimForm(TEMPLATE, c, S)).rejects.toThrow('A page can hold at most 13 lines.');
  }, SLOW);
});

describe('names and dates', () => {
  it('submits on the 1st of the next month, and names the file after the person', () => {
    expect([firstOfNextMonth(10, 2026), firstOfNextMonth(12, 2026)]).toEqual(['2026-11-01', '2027-01-01']);
    expect(formFileName('MABUNDA YP')).toBe('MABUNDA YP.pdf');
    expect(formFileName('O/NEIL: AB')).toBe('O NEIL AB.pdf');
  });
});
