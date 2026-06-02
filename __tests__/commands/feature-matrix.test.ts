// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runFeatureMatrixExport } from '../../src/commands/feature-matrix.js'

const SAMPLE_MATRIX = `# FEATURE_MATRIX

<!-- FEATURE_MATRIX_START -->
| feature_id | capability | kit_dims | level | status | code_ref | test_ref | doc_ref | issue_ref | note |
|---|---|---|---|---|---|---|---|---|---|
| REQ-001 | Architecture | N01 | L2 | Missing | | | | #1 | |
<!-- FEATURE_MATRIX_END -->

## Summary

| Status | Count |
|---|---|
| Missing | 1 |
| **Total** | **1** |
`

function makeDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'fm-cmd-test-'))
  writeFileSync(join(dir, 'FEATURE_MATRIX.md'), SAMPLE_MATRIX, 'utf-8')
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('runFeatureMatrixExport', () => {
  let dir: string
  let cleanup: () => void

  beforeEach(() => {
    const result = makeDir()
    dir = result.dir
    cleanup = result.cleanup
  })

  afterEach(() => {
    cleanup()
  })

  it('exports CSV to the specified output path', async () => {
    const outPath = join(dir, 'feature-matrix.csv')
    await runFeatureMatrixExport({
      format: 'csv',
      out: outPath,
      matrixPath: join(dir, 'FEATURE_MATRIX.md'),
    })
    expect(existsSync(outPath)).toBe(true)
  })

  it('CSV export contains header row', async () => {
    const { readFileSync } = await import('node:fs')
    const outPath = join(dir, 'feature-matrix.csv')
    await runFeatureMatrixExport({
      format: 'csv',
      out: outPath,
      matrixPath: join(dir, 'FEATURE_MATRIX.md'),
    })
    const content = readFileSync(outPath, 'utf-8')
    expect(content).toContain('feature_id')
  })

  it('CSV export contains data rows', async () => {
    const { readFileSync } = await import('node:fs')
    const outPath = join(dir, 'feature-matrix.csv')
    await runFeatureMatrixExport({
      format: 'csv',
      out: outPath,
      matrixPath: join(dir, 'FEATURE_MATRIX.md'),
    })
    const content = readFileSync(outPath, 'utf-8')
    expect(content).toContain('REQ-001')
  })

  it('exports xlsx to the specified output path', async () => {
    const outPath = join(dir, 'feature-matrix.xlsx')
    await runFeatureMatrixExport({
      format: 'xlsx',
      out: outPath,
      matrixPath: join(dir, 'FEATURE_MATRIX.md'),
    })
    expect(existsSync(outPath)).toBe(true)
  })

  it('xlsx file is a non-empty buffer', async () => {
    const { statSync } = await import('node:fs')
    const outPath = join(dir, 'feature-matrix.xlsx')
    await runFeatureMatrixExport({
      format: 'xlsx',
      out: outPath,
      matrixPath: join(dir, 'FEATURE_MATRIX.md'),
    })
    expect(statSync(outPath).size).toBeGreaterThan(0)
  })

  it('throws when matrix file is missing', async () => {
    await expect(
      runFeatureMatrixExport({
        format: 'csv',
        out: join(dir, 'out.csv'),
        matrixPath: join(dir, 'MISSING.md'),
      }),
    ).rejects.toThrow()
  })
})
