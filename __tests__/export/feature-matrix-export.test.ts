// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import {
  featureMatrixToCsv,
  parseFeatureMatrixRows,
} from '../../src/export/feature-matrix-export.js'

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
})
