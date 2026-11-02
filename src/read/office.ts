// Opening Word (.docx) and Excel (.xlsx) files. Both are zip folders of XML
// files. Everything works from the file's bytes, so the website, the phone
// app and the tests share it, and nothing is written to disk.

import { DOMParser, type Document, type Element } from '@xmldom/xmldom';
import { strFromU8, unzipSync } from 'fflate';

/** Word's XML namespace. */
export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

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
