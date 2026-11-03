// The month's control list (Excel), as the brief sets out: alphabetical by
// surname, with TOTAL AMOUNT as a live formula (=F2*G2), not a typed number.
// The student number and bank columns are left empty for the administrators
// to fill in from the submitted packs; this program never handles them.

import { strToU8, zipSync } from 'fflate';

export const CONTROL_LIST_HEADINGS = [
  '#', 'SURNAME', 'INITIALS', 'STUDENT NO:', 'LEVEL OF STUDY', 'HOURS WORKED',
  'RATE/HOUR', 'TOTAL AMOUNT', 'BANK NAME', 'BRANCH CODE', 'ACCOUNT NUMBER',
] as const;

export interface ControlListRow {
  surname: string;
  initials: string;
  level: string;
  minutes: number;
  /** Null leaves the rate empty (the checks report says why). */
  rateCents: number | null;
}

const X = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PR = 'http://schemas.openxmlformats.org/package/2006/relationships';

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Cell styles, by their place in styles.xml. */
const STYLE = { plain: 0, heading: 1, money: 2 };

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${X}">
<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;R&quot;#,##0.00"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const columnLetter = (i: number) => String.fromCharCode(65 + i);

/** The control list as an .xlsx file's bytes. */
export function controlList(rows: ControlListRow[]): Uint8Array {
  const sorted = [...rows].sort((a, b) => a.surname.localeCompare(b.surname) || a.initials.localeCompare(b.initials));
  const text = (ref: string, s: string, style = STYLE.plain) =>
    `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${escape(s)}</t></is></c>`;
  const number = (ref: string, n: number, style = STYLE.plain) => `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${n}</v></c>`;

  const heading = `<row r="1">${CONTROL_LIST_HEADINGS.map((h, i) => text(`${columnLetter(i)}1`, h, STYLE.heading)).join('')}</row>`;
  const body = sorted.map((p, i) => {
    const r = i + 2;
    const hours = p.minutes / 60;
    const rate = p.rateCents === null ? null : p.rateCents / 100;
    return (
      `<row r="${r}">` +
      number(`A${r}`, i + 1) +
      text(`B${r}`, p.surname) +
      text(`C${r}`, p.initials) +
      text(`E${r}`, p.level) +
      number(`F${r}`, hours) +
      (rate === null ? '' : number(`G${r}`, rate, STYLE.money)) +
      // A live formula; the value after it is only what a viewer shows before it recalculates.
      `<c r="H${r}" s="${STYLE.money}"><f>F${r}*G${r}</f><v>${hours * (rate ?? 0)}</v></c>` +
      `</row>`
    );
  });
  const widths = [5, 22, 10, 14, 16, 14, 12, 15, 14, 13, 16];
  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${X}">` +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${heading}${body.join('')}</sheetData></worksheet>`;

  return zipSync({
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `</Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PR}">` +
        `<Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="${X}" xmlns:r="${R}">` +
        `<sheets><sheet name="Control list" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="0" fullCalcOnLoad="1"/></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PR}">` +
        `<Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="${R}/styles" Target="styles.xml"/></Relationships>`,
    ),
    'xl/styles.xml': strToU8(STYLES),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  });
}
