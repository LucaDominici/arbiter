// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
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

  it('generates 1 file at L2', () => {
    const config = makeConfig(dir)
    expect(generateFeatureMatrix(config).files).toHaveLength(1)
  })

  it('generates 1 file at L3', () => {
    const config = makeConfig(dir, { governanceLevel: 'L3' })
    expect(generateFeatureMatrix(config).files).toHaveLength(1)
  })

  it('generates 1 file at L4', () => {
    const config = makeConfig(dir, { governanceLevel: 'L4' })
    expect(generateFeatureMatrix(config).files).toHaveLength(1)
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
