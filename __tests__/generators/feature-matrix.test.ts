// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateFeatureMatrix } from '../../src/generators/feature-matrix.js'
import { renderTemplate } from '../../src/utils/render.js'

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
  it('generates 3 files at L2', () => {
    const config = makeConfig(dir)
    expect(generateFeatureMatrix(config).files).toHaveLength(3)
  })

  it('generates 3 files at L3', () => {
    const config = makeConfig(dir, { governanceLevel: 'L3' })
    expect(generateFeatureMatrix(config).files).toHaveLength(3)
  })

  it('generates 3 files at L4', () => {
    const config = makeConfig(dir, { governanceLevel: 'L4' })
    expect(generateFeatureMatrix(config).files).toHaveLength(3)
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

/** Promote the scaffold's first requirement to `Verified` and fix the summary counters. */
function promoteFirstRowToVerified(dir: string): void {
  const matrixPath = join(dir, 'docs', 'FEATURE_MATRIX.md')
  const text = readFileSync(matrixPath, 'utf-8')
  const firstRow = /^\| REQ-\d+ \|.*$/m.exec(text)
  if (!firstRow) throw new Error('the scaffolded matrix has no REQ row to promote')
  const cells = firstRow[0].split('|')
  const before = (cells[5] ?? '').trim()
  cells[5] = ' Verified '
  writeFileSync(
    matrixPath,
    text
      .replace(firstRow[0], cells.join('|'))
      .replace('| Verified | 0 |', '| Verified | 1 |')
      .replace(new RegExp(`\\| ${before} \\| 16 \\|`), `| ${before} | 15 |`),
    'utf-8',
  )
}

/** The validator another generator owns (#1578), staged here so axis 2 can actually adjudicate. */
function emitValidator(dir: string): void {
  mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true })
  writeFileSync(
    join(dir, 'scripts', 'lib', 'agent-return-validate.mjs'),
    renderTemplate(
      'scripts/lib/agent-return-validate.mjs.ejs',
      makeConfig(dir) as unknown as Record<string, unknown>,
    ),
    'utf-8',
  )
}

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

  // #2480: this generator, ALONE, must produce a gate that runs. The RTM axis-2 rule brought two
  // dependencies with it — a schema and the shared validator — and leaving either to another
  // generator's emission table produced a file that renders perfectly and dies on
  // MODULE_NOT_FOUND before reading a row. That is the #2335 failure exactly, and only running the
  // thing catches it.
  // #2480/#1578: the axis-2 rule needs the shared validator, and exactly one generator may write
  // each path — so this generator does NOT emit it, and the gate must therefore survive its
  // absence. It survives by SAYING SO on a Verified row, never by skipping: a rule that quietly
  // stops applying is the failure the gate exists to prevent. Run standalone, which is the only
  // way to see it: the first cut of this port died on MODULE_NOT_FOUND before reading a row.
  it('runs with no other generator, and names the dependency it is missing', () => {
    generateFeatureMatrix(makeConfig(dir))
    expect(existsSync(join(dir, 'scripts', 'lib', 'agent-return-validate.mjs'))).toBe(false)
    expect(existsSync(join(dir, 'schemas', 'rtm-verdict.schema.json'))).toBe(true)
    // No Verified row in the scaffold, so nothing is loaded and nothing is missed.
    expect(() =>
      execFileSync('node', ['scripts/check-feature-matrix.mjs'], { cwd: dir, stdio: 'pipe' }),
    ).not.toThrow()
    promoteFirstRowToVerified(dir)
    let out = ''
    try {
      execFileSync('node', ['scripts/check-feature-matrix.mjs'], { cwd: dir, stdio: 'pipe' })
    } catch (err) {
      out = String((err as { stdout?: Buffer }).stdout ?? '')
    }
    expect(out).toMatch(/agent-return-validate\.mjs is missing/)
    expect(out).not.toMatch(/MODULE_NOT_FOUND/)
  })

  it('refuses a Verified row with no verification envelope, in the emitted copy (axis 2)', () => {
    generateFeatureMatrix(makeConfig(dir))
    emitValidator(dir)
    promoteFirstRowToVerified(dir)
    let out = ''
    try {
      execFileSync('node', ['scripts/check-feature-matrix.mjs'], { cwd: dir, stdio: 'pipe' })
    } catch (err) {
      out = String((err as { stdout?: Buffer }).stdout ?? '')
    }
    expect(out).toMatch(/RTM verdict ratchet/)
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
