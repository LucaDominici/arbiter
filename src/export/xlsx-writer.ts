// SPDX-License-Identifier: Apache-2.0
// Minimal zero-dependency .xlsx emitter.
//
// A .xlsx is a ZIP archive of OOXML parts. This writer builds the smallest
// valid single-sheet workbook (inline strings — no sharedStrings part) using
// STORE (compression method 0) entries, so `compressed size == uncompressed
// size` and the most common zip bug class is eliminated. CRC-32 is hand-rolled
// (polynomial 0xEDB88320) because `node:zlib.crc32` only landed mid-Node-22.x
// while `engines.node` permits `>=22.0.0`. The in-repo precedent for a
// hand-rolled, no-external-deps binary writer is `src/commands/report.ts`
// (POSIX ustar tar via `node:zlib`); zip framing is structurally unrelated, so
// this is a new module rather than a refactor of that one (CANON-16 survey).
//
// Formula-injection (CWE-1236): every cell value is run through
// `neutralizeFormula` (reused from `src/kit/csv.ts`) before escaping. The real
// protection is structural — `t="inlineStr"` cells are never evaluated as
// formulas in OOXML (formula cells use `<f>` children, a different code path) —
// so the `'` prefix added by `neutralizeFormula` is defense-in-depth, kept for
// parity with the previous exceljs emitter's output. Control chars are stripped
// BEFORE neutralization so a control-char-prefixed payload still triggers the
// regex on its post-strip start.
//
// XML 1.0 note: a CR-LF sequence in a cell value normalises to LF on parse by
// any conformant XML reader (incl. Excel); this is inherent to XML (the
// previous exceljs path had the same behaviour) — no mitigation.
import { neutralizeFormula } from '../kit/csv.js'

interface XlsxSheet {
  /** Worksheet name (shown on the sheet tab). */
  name: string
  /** Column headers (row 1). Bold-styled via the `s="1"` cellXf. */
  headers: string[]
  /** Data rows; `rows[i][j]` populates column `j+1` of row `i+2`. */
  rows: string[][]
  /** Optional column widths (1-based, in character units). Emits `<cols>` when present. */
  colWidths?: number[]
}

// --- CRC-32 (IEEE 802.3, polynomial 0xEDB88320, reflected) -----------------
const CRC_TABLE: Uint32Array = ((): Uint32Array => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n >>> 0
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    const byte = buf.readUInt8(i)
    c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

// --- XML text helpers -------------------------------------------------------

// Strip XML-1.0-illegal control chars (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F).
// TAB (0x09), LF (0x0A), CR (0x0D) are legal in XML text and retained.
function stripControlChars(s: string): string {
  // eslint-disable-next-line no-control-regex -- intentional: these are exactly the chars XML 1.0 forbids in text content.
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
}

// Escape XML TEXT content (`<t>` bodies): `&` `<` `>` are escaped; `"` and `'`
// are left literal (they only require escaping inside attribute values). For
// ATTRIBUTE values (e.g. the sheet `name="..."` in workbook.xml) use
// `xmlAttrEscape`, which also escapes `"` and `'` — an unescaped quote in an
// attribute truncates it and yields malformed XML. The only other attribute
// this writer emits, `r="<col><row>"`, is alphanumeric via `colLetter` and
// needs no escaping.
function xmlEscape(s: string): string {
  return stripControlChars(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Escape XML ATTRIBUTE values: `&` `<` `>` `"` `'` all escaped. Use for any
// attribute whose value comes from a caller-provided string (the sheet `name`).
function xmlAttrEscape(s: string): string {
  return xmlEscape(s).replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

// 1-based column index → spreadsheet letter (1→A, 26→Z, 27→AA).
function colLetter(n: number): string {
  let s = ''
  let m = n
  while (m > 0) {
    const r = (m - 1) % 26
    s = String.fromCharCode(65 + r) + s
    m = Math.floor((m - 1) / 26)
  }
  return s
}

// Cell value → escaped inline-string cell text.
function cellText(value: string): string {
  // strip → neutralize → escape (order matters: strip first so a control-char
  // prefix cannot hide a formula trigger from `neutralizeFormula`).
  const escaped = xmlEscape(neutralizeFormula(stripControlChars(value)))
  return `<is><t xml:space="preserve">${escaped}</t></is>`
}

// --- OOXML parts ------------------------------------------------------------

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

function contentTypesXml(): string {
  return (
    XML_DECL +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n' +
    '<Default Extension="xml" ContentType="application/xml"/>\n' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>\n' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>\n' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>\n' +
    '</Types>\n'
  )
}

function rootRelsXml(): string {
  return (
    XML_DECL +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>\n' +
    '</Relationships>\n'
  )
}

function workbookXml(name: string): string {
  return (
    XML_DECL +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n' +
    '<sheets>\n' +
    `<sheet name="${xmlAttrEscape(name)}" sheetId="1" r:id="rId1"/>\n` +
    '</sheets>\n' +
    '</workbook>\n'
  )
}

function workbookRelsXml(): string {
  return (
    XML_DECL +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>\n' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>\n' +
    '</Relationships>\n'
  )
}

function stylesXml(): string {
  return (
    XML_DECL +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n' +
    '<fonts count="2">\n' +
    '<font><sz val="11"/><name val="Calibri"/></font>\n' +
    '<font><b/><sz val="11"/><name val="Calibri"/></font>\n' +
    '</fonts>\n' +
    '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>\n' +
    '<borders count="1"><border/></borders>\n' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>\n' +
    '<cellXfs count="2">\n' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>\n' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>\n' +
    '</cellXfs>\n' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>\n' +
    '</styleSheet>\n'
  )
}

function sheetXml(sheet: XlsxSheet): string {
  const { headers, rows, colWidths } = sheet
  const lastCol = colLetter(headers.length)
  const lastRow = rows.length + 1 // header counted

  const cols =
    colWidths && colWidths.length > 0
      ? `<cols>${colWidths
          .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
          .join('')}</cols>\n`
      : ''

  const headerCells = headers
    .map((h, i) => `<c r="${colLetter(i + 1)}1" t="inlineStr" s="1">${cellText(h)}</c>`)
    .join('')

  const dataRows = rows
    .map((row, r) => {
      const rowIdx = r + 2
      const cells = row
        .map((val, i) => `<c r="${colLetter(i + 1)}${rowIdx}" t="inlineStr">${cellText(val)}</c>`)
        .join('')
      return `<row r="${rowIdx}">${cells}</row>`
    })
    .join('')

  return (
    XML_DECL +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n' +
    `<dimension ref="A1:${lastCol}${lastRow}"/>\n` +
    cols +
    '<sheetData>\n' +
    `<row r="1">${headerCells}</row>\n` +
    dataRows +
    '</sheetData>\n' +
    '</worksheet>\n'
  )
}

// --- zip framing (STORE only) -----------------------------------------------

function makeLocalHeader(name: string, data: Buffer): Buffer {
  const nameBuf = Buffer.from(name, 'utf8')
  const hdr = Buffer.alloc(30 + nameBuf.length)
  hdr.writeUInt32LE(0x04034b50, 0) // signature PK\x03\x04
  hdr.writeUInt16LE(20, 4) // version needed
  hdr.writeUInt16LE(0, 6) // general-purpose flag
  hdr.writeUInt16LE(0, 8) // compression method = STORE
  hdr.writeUInt16LE(0, 10) // last mod time
  hdr.writeUInt16LE(0, 12) // last mod date
  hdr.writeUInt32LE(crc32(data), 14) // CRC-32
  hdr.writeUInt32LE(data.length, 18) // compressed size
  hdr.writeUInt32LE(data.length, 22) // uncompressed size
  hdr.writeUInt16LE(nameBuf.length, 26) // filename length
  hdr.writeUInt16LE(0, 28) // extra-field length
  nameBuf.copy(hdr, 30)
  return hdr
}

function makeCentralDirHeader(
  name: string,
  localOffset: number,
  crc: number,
  size: number,
): Buffer {
  const nameBuf = Buffer.from(name, 'utf8')
  const hdr = Buffer.alloc(46 + nameBuf.length)
  hdr.writeUInt32LE(0x02014b50, 0) // signature PK\x01\x02
  hdr.writeUInt16LE(20, 4) // version made by
  hdr.writeUInt16LE(20, 6) // version needed
  hdr.writeUInt16LE(0, 8) // general-purpose flag
  hdr.writeUInt16LE(0, 10) // compression method = STORE
  hdr.writeUInt16LE(0, 12) // last mod time
  hdr.writeUInt16LE(0, 14) // last mod date
  hdr.writeUInt32LE(crc, 16) // CRC-32
  hdr.writeUInt32LE(size, 20) // compressed size
  hdr.writeUInt32LE(size, 24) // uncompressed size
  hdr.writeUInt16LE(nameBuf.length, 28) // filename length
  hdr.writeUInt16LE(0, 30) // extra-field length
  hdr.writeUInt16LE(0, 32) // comment length
  hdr.writeUInt16LE(0, 34) // disk number start
  hdr.writeUInt16LE(0, 36) // internal attributes
  hdr.writeUInt32LE(0, 38) // external attributes
  hdr.writeUInt32LE(localOffset, 42) // offset of local header
  nameBuf.copy(hdr, 46)
  return hdr
}

function makeEocd(entryCount: number, cdSize: number, cdOffset: number): Buffer {
  const hdr = Buffer.alloc(22)
  hdr.writeUInt32LE(0x06054b50, 0) // signature PK\x05\x06
  hdr.writeUInt16LE(0, 4) // disk number
  hdr.writeUInt16LE(0, 6) // disk with central dir
  hdr.writeUInt16LE(entryCount, 8) // entries on this disk
  hdr.writeUInt16LE(entryCount, 10) // total entries
  hdr.writeUInt32LE(cdSize, 12) // size of central dir
  hdr.writeUInt32LE(cdOffset, 16) // offset of central dir
  hdr.writeUInt16LE(0, 20) // comment length
  return hdr
}

/**
 * Build a minimal .xlsx workbook as a `Buffer`.
 *
 * @returns A ZIP/OOXML buffer loadable by Excel, LibreOffice Calc, and exceljs.
 */
export function writeXlsx(sheet: XlsxSheet): Buffer {
  if (sheet.headers.length === 0) {
    // colLetter(0) would return '' and produce a malformed <dimension ref="A1:1"/>;
    // a headerless sheet is not a valid workbook. Fail loudly rather than emit corrupt XML.
    throw new Error('writeXlsx: at least one header column is required')
  }
  const parts = new Map<string, Buffer>([
    ['[Content_Types].xml', Buffer.from(contentTypesXml(), 'utf8')],
    ['_rels/.rels', Buffer.from(rootRelsXml(), 'utf8')],
    ['xl/workbook.xml', Buffer.from(workbookXml(sheet.name), 'utf8')],
    ['xl/_rels/workbook.xml.rels', Buffer.from(workbookRelsXml(), 'utf8')],
    ['xl/styles.xml', Buffer.from(stylesXml(), 'utf8')],
    ['xl/worksheets/sheet1.xml', Buffer.from(sheetXml(sheet), 'utf8')],
  ])

  const localChunks: Buffer[] = []
  const centralChunks: Buffer[] = []
  let offset = 0
  for (const [name, data] of parts) {
    const local = makeLocalHeader(name, data)
    localChunks.push(local, data)
    centralChunks.push(makeCentralDirHeader(name, offset, crc32(data), data.length))
    offset += local.length + data.length
  }
  const localSection = Buffer.concat(localChunks)
  const centralSection = Buffer.concat(centralChunks)
  const eocd = makeEocd(parts.size, centralSection.length, localSection.length)
  return Buffer.concat([localSection, centralSection, eocd])
}

/**
 * @internal Test-only export of the writer primitives, consumed by
 * `__tests__/export/xlsx-writer.test.ts` so the value export is not flagged as
 * unused by `check-no-unused-exports`. Do not depend on this from production code.
 */
export const __internal = {
  crc32,
  xmlEscape,
  xmlAttrEscape,
  colLetter,
  makeLocalHeader,
  makeCentralDirHeader,
  makeEocd,
}
