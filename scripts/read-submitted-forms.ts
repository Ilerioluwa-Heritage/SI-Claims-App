// Reads the session lines and totals from submitted HRM-05 claim forms, so the
// rules can be tested against what was actually claimed.
//
// POPIA: only the fields on ALLOWED below are ever read. Personal details on
// the form (student number, cell, address, bank, signature) and any attached
// pages (ID, bank letter, proof of registration) are never read or printed.
//
//   node scripts/read-submitted-forms.ts --fields <pdf>        field names only, no values
//   node scripts/read-submitted-forms.ts <folder> <out.json>   lines and totals of every PDF

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { PDFDocument, PDFRef, PDFTextField } from 'pdf-lib';

// Session lines 1-13: DATE2-DATE14 and the 0-12 suffixed fields (see the README's note on the off-by-one).
const LINE = /^(?:DATE(?:1[0-4]|[2-9])|(?:NAME_OF_THE_PROGRAMME|NATURE_OF_SERVICE_RENDERED|TIME_IN|TIME_OUT|HOURS_WORKED)(?:1[0-2]|[0-9]))$/;
const TOTALS: Record<string, string> = {
  Textfield4: 'month',
  Textfield5: 'year',
  Textfield6: 'hours',
  Textfield9: 'hoursAgain',
  Textfield7: 'rate',
  Textfield8: 'amount',
};
const isAllowed = (name: string) => LINE.test(name) || name in TOTALS;

async function load(path: string) {
  return PDFDocument.load(readFileSync(path), { ignoreEncryption: true, updateMetadata: false });
}

/** Page number (1-based) of each widget annotation, by object reference. */
function widgetPages(doc: PDFDocument): Map<string, number> {
  const pages = new Map<string, number>();
  doc.getPages().forEach((page, i) => {
    const annots = page.node.Annots();
    for (let j = 0; j < (annots?.size() ?? 0); j++) {
      const ref = annots!.get(j);
      if (ref instanceof PDFRef) pages.set(ref.toString(), i + 1);
    }
  });
  return pages;
}

async function listFields(path: string) {
  const doc = await load(path);
  const pages = widgetPages(doc);
  const fields = doc.getForm().getFields();
  console.log(`${basename(path)}: ${doc.getPageCount()} pages, ${fields.length} form fields`);
  for (const f of fields) {
    const onPages = f.acroField
      .getWidgets()
      .map((w) => pages.get(doc.context.getObjectRef(w.dict)?.toString() ?? '') ?? '?');
    const filled = f instanceof PDFTextField ? (f.getText() ?? '') !== '' : '-';
    console.log(`  ${f.getName().padEnd(34)} ${f.constructor.name.padEnd(14)} page ${onPages.join(',')}  filled: ${filled}`);
  }
}

interface FormLine { row: number; date: string; programme: string; service: string; timeIn: string; timeOut: string; hours: string }
interface FormFigures { file: string; totals: Record<string, string>; lines: FormLine[] }

async function readFigures(path: string): Promise<FormFigures> {
  const doc = await load(path);
  const values = new Map<string, string>();
  for (const f of doc.getForm().getFields()) {
    const name = f.getName();
    if (isAllowed(name) && f instanceof PDFTextField) values.set(name, (f.getText() ?? '').trim());
  }
  const get = (n: string) => values.get(n) ?? '';
  const totals: Record<string, string> = {};
  for (const [field, label] of Object.entries(TOTALS)) totals[label] = get(field);
  const lines: FormLine[] = [];
  for (let n = 1; n <= 13; n++) {
    const s = String(n - 1);
    const line = {
      row: n,
      date: get(`DATE${n + 1}`),
      programme: get(`NAME_OF_THE_PROGRAMME${s}`),
      service: get(`NATURE_OF_SERVICE_RENDERED${s}`),
      timeIn: get(`TIME_IN${s}`),
      timeOut: get(`TIME_OUT${s}`),
      hours: get(`HOURS_WORKED${s}`),
    };
    if (line.date || line.service || line.timeIn || line.timeOut || line.hours) lines.push(line);
  }
  return { file: basename(path), totals, lines };
}

const args = process.argv.slice(2);
if (args[0] === '--fields' && args[1]) {
  await listFields(args[1]);
} else if (args.length === 2) {
  const [folder, out] = args as [string, string];
  const results: FormFigures[] = [];
  for (const file of readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.pdf')).sort()) {
    try {
      results.push(await readFigures(join(folder, file)));
    } catch (e) {
      console.log(`${file}: could not read (${(e as Error).message})`);
    }
  }
  writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(`${results.length} forms read -> ${out}`);
} else {
  console.log('Usage: --fields <pdf>  |  <folder> <out.json>');
}
