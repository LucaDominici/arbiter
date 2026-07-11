// SPDX-License-Identifier: Apache-2.0
// CANON-05 — every generator under src/generators/ has a test.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateGap } from '../../src/generators/gap.js'
import { generateFeatureMatrix } from '../../src/generators/feature-matrix.js'

describe('generateGap', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('returns no files at L1 — gate is L2+ only', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    expect(generateGap(config).files).toHaveLength(0)
  })

  // #1887-B: 2 files — the doc + the gen-gap.mjs gate its own header comment
  // promises (previously never emitted).
  it('generates 2 files at L2', () => {
    const config = makeConfig(dir)
    expect(generateGap(config).files).toHaveLength(2)
  })

  it('generates 2 files at L3', () => {
    const config = makeConfig(dir, { governanceLevel: 'L3' })
    expect(generateGap(config).files).toHaveLength(2)
  })

  it('generates 2 files at L4', () => {
    const config = makeConfig(dir, { governanceLevel: 'L4' })
    expect(generateGap(config).files).toHaveLength(2)
  })

  it('generates scripts/gen-gap.mjs at L2+', () => {
    const config = makeConfig(dir)
    generateGap(config)
    expect(existsSync(join(dir, 'scripts', 'gen-gap.mjs'))).toBe(true)
  })

  it('generates docs/GAP.md at L2+', () => {
    const config = makeConfig(dir)
    generateGap(config)
    expect(existsSync(join(dir, 'docs', 'GAP.md'))).toBe(true)
  })

  it('generated file contains GAP_START sentinel', () => {
    const config = makeConfig(dir)
    generateGap(config)
    const content = readFileSync(join(dir, 'docs', 'GAP.md'), 'utf-8')
    expect(content).toContain('<!-- GAP_START -->')
  })

  it('skipIfExists: does not overwrite existing GAP.md', () => {
    const config = makeConfig(dir)
    generateGap(config)
    const file1 = readFileSync(join(dir, 'docs', 'GAP.md'), 'utf-8')
    const result2 = generateGap(config)
    const file2 = readFileSync(join(dir, 'docs', 'GAP.md'), 'utf-8')
    expect(file1).toBe(file2)
    expect(result2.files[0]?.action).toBe('skipped')
  })
})

// #1887-B: materialized self-pass — the emitted gen-gap.mjs --check must
// actually PASS when run against the docs/GAP.md + docs/FEATURE_MATRIX.md the
// same init just wrote (coverage check, not exact-byte regeneration — see the
// script's own header comment for why).
describe('generateGap — gen-gap.mjs --check self-pass (#1887-B)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('emitted gen-gap.mjs --check exits 0 against the freshly emitted GAP.md + matrix', () => {
    const config = makeConfig(dir)
    generateFeatureMatrix(config)
    generateGap(config)
    expect(() =>
      execFileSync('node', ['scripts/gen-gap.mjs', '--check'], { cwd: dir, stdio: 'pipe' }),
    ).not.toThrow()
  })

  it('exits 1 when a tracked feature_id is dropped from GAP.md (drift)', () => {
    const config = makeConfig(dir)
    generateFeatureMatrix(config)
    generateGap(config)
    const gapPath = join(dir, 'docs', 'GAP.md')
    const dropped = readFileSync(gapPath, 'utf-8').replace(/REQ-001/g, 'DROPPED')
    writeFileSync(gapPath, dropped, 'utf-8')
    expect(() =>
      execFileSync('node', ['scripts/gen-gap.mjs', '--check'], { cwd: dir, stdio: 'pipe' }),
    ).toThrow()
  })

  it('--write regenerates the Feature Gaps table and then --check passes', () => {
    const config = makeConfig(dir)
    generateFeatureMatrix(config)
    generateGap(config)
    const gapPath = join(dir, 'docs', 'GAP.md')
    writeFileSync(gapPath, readFileSync(gapPath, 'utf-8').replace(/REQ-001/g, 'DROPPED'), 'utf-8')
    execFileSync('node', ['scripts/gen-gap.mjs', '--write'], { cwd: dir, stdio: 'pipe' })
    expect(() =>
      execFileSync('node', ['scripts/gen-gap.mjs', '--check'], { cwd: dir, stdio: 'pipe' }),
    ).not.toThrow()
  })
})
