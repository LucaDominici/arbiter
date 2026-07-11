// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateFeatureMatrix } from '../../src/generators/feature-matrix.js'

describe('generateFeatureMatrix', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('returns no files at L1 — gate is L2+ only', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    expect(generateFeatureMatrix(config).files).toHaveLength(0)
  })

  // #1887-B: 2 files — the doc + the check-feature-matrix.mjs gate its own
  // header comment promises (previously never emitted).
  it('generates 2 files at L2', () => {
    const config = makeConfig(dir)
    expect(generateFeatureMatrix(config).files).toHaveLength(2)
  })

  it('generates 2 files at L3', () => {
    const config = makeConfig(dir, { governanceLevel: 'L3' })
    expect(generateFeatureMatrix(config).files).toHaveLength(2)
  })

  it('generates 2 files at L4', () => {
    const config = makeConfig(dir, { governanceLevel: 'L4' })
    expect(generateFeatureMatrix(config).files).toHaveLength(2)
  })

  it('generates scripts/check-feature-matrix.mjs at L2+', () => {
    const config = makeConfig(dir)
    generateFeatureMatrix(config)
    expect(existsSync(join(dir, 'scripts', 'check-feature-matrix.mjs'))).toBe(true)
  })

  it('generates docs/FEATURE_MATRIX.md at L2+', () => {
    const config = makeConfig(dir)
    generateFeatureMatrix(config)
    expect(existsSync(join(dir, 'docs', 'FEATURE_MATRIX.md'))).toBe(true)
  })

  it('generated file contains sentinel markers', () => {
    const config = makeConfig(dir)
    generateFeatureMatrix(config)
    const content = readFileSync(join(dir, 'docs', 'FEATURE_MATRIX.md'), 'utf-8')
    expect(content).toContain('<!-- FEATURE_MATRIX_START -->')
    expect(content).toContain('<!-- FEATURE_MATRIX_END -->')
  })

  it('generated file contains status vocabulary', () => {
    const config = makeConfig(dir)
    generateFeatureMatrix(config)
    const content = readFileSync(join(dir, 'docs', 'FEATURE_MATRIX.md'), 'utf-8')
    expect(content).toMatch(/Missing|Partial|Done|Verified/)
  })

  it('generated file contains kit_dims column header', () => {
    const config = makeConfig(dir)
    generateFeatureMatrix(config)
    const content = readFileSync(join(dir, 'docs', 'FEATURE_MATRIX.md'), 'utf-8')
    expect(content).toContain('kit_dims')
  })

  it('skipIfExists: does not overwrite existing FEATURE_MATRIX.md', () => {
    const config = makeConfig(dir)
    generateFeatureMatrix(config)
    const file1 = readFileSync(join(dir, 'docs', 'FEATURE_MATRIX.md'), 'utf-8')
    // Second run should skip
    const result2 = generateFeatureMatrix(config)
    const file2 = readFileSync(join(dir, 'docs', 'FEATURE_MATRIX.md'), 'utf-8')
    expect(file1).toBe(file2)
    expect(result2.files[0]?.action).toBe('skipped')
  })

  it('template schema parity: column header matches Track A sentinel block schema', () => {
    const config = makeConfig(dir)
    generateFeatureMatrix(config)
    const content = readFileSync(join(dir, 'docs', 'FEATURE_MATRIX.md'), 'utf-8')
    // Must contain all required columns
    for (const col of [
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
      expect(content, `Column "${col}" missing from generated FEATURE_MATRIX.md`).toContain(col)
    }
  })
})

// #1887-B: materialized self-pass — the emitted check-feature-matrix.mjs must
// actually PASS when run against the FEATURE_MATRIX.md the same generator just
// wrote (self-consistency, not just render-without-throwing).
describe('generateFeatureMatrix — check-feature-matrix.mjs self-pass (#1887-B)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('emitted check-feature-matrix.mjs exits 0 against the freshly emitted matrix', () => {
    const config = makeConfig(dir)
    generateFeatureMatrix(config)
    expect(() =>
      execFileSync('node', ['scripts/check-feature-matrix.mjs'], { cwd: dir, stdio: 'pipe' }),
    ).not.toThrow()
  })

  it('exits 1 when a status ladder rule is violated (Missing without a valid issue_ref)', () => {
    const config = makeConfig(dir)
    generateFeatureMatrix(config)
    const matrixPath = join(dir, 'docs', 'FEATURE_MATRIX.md')
    const broken = readFileSync(matrixPath, 'utf-8').replace('| #1 |', '| — |')
    writeFileSync(matrixPath, broken, 'utf-8')
    expect(() =>
      execFileSync('node', ['scripts/check-feature-matrix.mjs'], { cwd: dir, stdio: 'pipe' }),
    ).toThrow()
  })
})
