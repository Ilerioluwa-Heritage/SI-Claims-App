// Opening Word (.docx) and Excel (.xlsx) files. Both are zip folders of XML
// files. Everything works from the file's bytes, so the website, the phone
// app and the tests share it, and nothing is written to disk.

import { DOMParser, type Document, type Element } from '@xmldom/xmldom';
import { strFromU8, unzipSync } from 'fflate';

/** Word's XML namespace. */
export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
/** Excel's XML namespaces. */
export const X = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Unzips only the named XML files (e.g. "word/document.xml") and parses them. */
export function openOffice(bytes: Uint8Array, wanted: string[]): Map<string, Document> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => wanted.includes(f.name) });
  } catch {
    throw new Error('This is not a Word or Excel file (.docx or .xlsx).');
  }
  const docs = new Map<string, Document>();
  for (const [name, data] of Object.entries(files)) {
    docs.set(name, new DOMParser().parseFromString(strFromU8(data), 'text/xml'));
  }
  return docs;
}

/** Direct child elements with this local name ("tr", "tc"), in order. */
export function children(parent: Element, localName: string): Element[] {
  const out: Element[] = [];
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (n as Element).localName === localName) out.push(n as Element);
  }
  return out;
}

/** All descendant elements with this local name, in document order. */
export function descendants(parent: Element, localName: string): Element[] {
  return Array.from(parent.getElementsByTagNameNS(W, localName));
}

/** One Excel cell: its text, and its number if it holds one (dates and times are numbers). */
export interface Cell {
  text: string;
  number: number | null;
}

/**
 * The first sheet of an Excel file, taking only the columns whose heading
 * (in row 1) passes `wanted`. Other columns are never extracted, so answers
 * like contact details stay unread. Rows come back in order, keyed by heading.
 */
export function readSheet(
  bytes: Uint8Array,
  wanted: (heading: string) => boolean,
): { headings: string[]; rows: { row: number; cells: Map<string, Cell> }[] } {
  const book = openOffice(bytes, ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/sharedStrings.xml']);
  const workbook = book.get('xl/workbook.xml');
  const rels = book.get('xl/_rels/workbook.xml.rels');
  if (!workbook || !rels) throw new Error('This Excel file has no workbook inside it.');
  const firstSheet = workbook.getElementsByTagNameNS(X, 'sheet')[0];
  const id = firstSheet?.getAttributeNS(REL, 'id');
  const rel = Array.from(rels.getElementsByTagName('Relationship')).find((r) => r.getAttribute('Id') === id);
  const target = rel?.getAttribute('Target') ?? '';
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  const sheet = openOffice(bytes, [path]).get(path);
  if (!sheet) throw new Error('This Excel file has no sheet inside it.');

  // Shared text is looked up only for the cells actually read.
  const shared = Array.from(book.get('xl/sharedStrings.xml')?.getElementsByTagNameNS(X, 'si') ?? []);
  const sharedText = (i: number) => {
    const si = shared[i];
    if (!si) return '';
    // Text runs only; phonetic guides (rPh) are left out.
    return Array.from(si.getElementsByTagNameNS(X, 't'))
      .filter((t) => (t.parentNode as Element | null)?.localName !== 'rPh')
      .map((t) => t.textContent ?? '')
      .join('');
  };
  const columnOf = (ref: string | null, position: number) => {
    const letters = /^[A-Z]+/.exec(ref ?? '')?.[0];
    if (!letters) return position;
    return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  };
  const cellOf = (c: Element): Cell => {
    const type = c.getAttribute('t');
    const v = children(c, 'v')[0]?.textContent ?? '';
    if (type === 's') return { text: sharedText(Number(v)), number: null };
    if (type === 'inlineStr') return { text: children(c, 'is')[0]?.textContent ?? '', number: null };
    if (type === 'str' || type === 'e' || type === 'b') return { text: v, number: null };
    return { text: v, number: v.trim() === '' ? null : Number(v) };
  };

  const rowEls = Array.from(sheet.getElementsByTagNameNS(X, 'row'));
  const headingCells = rowEls[0] ? children(rowEls[0], 'c') : [];
  const headings: string[] = [];
  const keep = new Map<number, string>();
  headingCells.forEach((c, i) => {
    const heading = cellOf(c).text.trim();
    const col = columnOf(c.getAttribute('r'), i);
    headings.push(heading);
    if (wanted(heading)) keep.set(col, heading);
  });

  const rows = rowEls.slice(1).map((rowEl, i) => {
    const cells = new Map<string, Cell>();
    children(rowEl, 'c').forEach((c, position) => {
      const heading = keep.get(columnOf(c.getAttribute('r'), position));
      if (heading !== undefined) cells.set(heading, cellOf(c));
    });
    return { row: Number(rowEl.getAttribute('r')) || i + 2, cells };
  });
  return { headings, rows };
}

/**
 * The text of a Word table cell as it reads on screen: paragraphs and tabs
 * become single spaces. Deleted text (tracked changes) is left out.
 */
export function wordText(cell: Element): string {
  let text = '';
  const walk = (el: Element) => {
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType !== 1) continue;
      const child = n as Element;
      switch (child.localName) {
        case 't':
          text += child.textContent ?? '';
          break;
        case 'tab':
        case 'br':
          if (el.localName === 'r') text += ' ';
          break;
        case 'p':
          walk(child);
          text += ' ';
          break;
        case 'pPr':
        case 'rPr':
        case 'del':
          break;
        default:
          walk(child);
      }
    }
  };
  walk(cell);
  return text.replace(/\s+/g, ' ').trim();
}
