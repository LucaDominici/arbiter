// SPDX-License-Identifier: Apache-2.0
// #1508 — mutation-score non-regression ratchet.
// The decision logic lives in the emitted scripts/verify-mutation-baseline.mjs as pure,
// exported `compareMutationScore` + `strykerScoreFromReport` so it is unit-testable in
// isolation (same pattern as verify-module-coverage / INV-134).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { generateCheckAll } from '../../src/generators/check-all.js'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('verify-mutation-baseline emission (#1508)', () => {
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-mutbase-emit-'))
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('check-all generator emits scripts/verify-mutation-baseline.mjs', () => {
    const result = generateCheckAll(makeConfig(dir, { language: 'typescript' }))
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('scripts/verify-mutation-baseline.mjs'))).toBe(true)
  })
})

describe('compareMutationScore + strykerScoreFromReport — pure (#1508)', () => {
  let mod: {
    SLACK: number
    compareMutationScore: (
      baselineScore: number | null | undefined,
      currentScore: number,
      slack?: number,
    ) => { violations: Array<{ reason: string }> }
    strykerScoreFromReport: (report: unknown) => number | null
  }
  let dir: string

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-mutbase-eval-'))
    const rendered = renderTemplate('scripts/verify-mutation-baseline.mjs.ejs', {
      ...makeConfig(dir, { language: 'typescript' }),
    } as unknown as Record<string, unknown>)
    const file = join(dir, 'verify-mutation-baseline.mjs')
    writeFileSync(file, rendered)
    mod = (await import(pathToFileURL(file).href)) as typeof mod
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('first run (no baseline) never violates', () => {
    expect(mod.compareMutationScore(null, 42).violations).toEqual([])
    expect(mod.compareMutationScore(undefined, 0).violations).toEqual([])
  })

  it('score within slack or higher does not violate', () => {
    expect(mod.compareMutationScore(80, 80).violations).toEqual([])
    expect(mod.compareMutationScore(80, 80 - mod.SLACK).violations).toEqual([])
    expect(mod.compareMutationScore(80, 95).violations).toEqual([])
  })

  it('score dropped more than slack is a violation', () => {
    const { violations } = mod.compareMutationScore(80, 70)
    expect(violations).toHaveLength(1)
    expect(violations[0].reason).toMatch(/dropped/)
  })

  it('non-numeric current score is a violation', () => {
    expect(mod.compareMutationScore(80, Number.NaN).violations).toHaveLength(1)
  })

  it('strykerScoreFromReport computes detected/(detected+undetected)*100', () => {
    const report = {
      files: {
        'a.ts': { mutants: [{ status: 'Killed' }, { status: 'Timeout' }, { status: 'Survived' }] },
        'b.ts': { mutants: [{ status: 'NoCoverage' }, { status: 'CompileError' }] },
      },
    }
    // detected = 2 (Killed+Timeout), undetected = 2 (Survived+NoCoverage); CompileError excluded.
    expect(mod.strykerScoreFromReport(report)).toBe(50)
  })

  it('strykerScoreFromReport returns null for absent/empty/uncovered reports', () => {
    expect(mod.strykerScoreFromReport(null)).toBeNull()
    expect(mod.strykerScoreFromReport({})).toBeNull()
    expect(mod.strykerScoreFromReport({ files: { 'a.ts': { mutants: [] } } })).toBeNull()
    // only excluded statuses → no scorable mutants → null (SKIP, never false-fail)
    expect(
      mod.strykerScoreFromReport({ files: { 'a.ts': { mutants: [{ status: 'Ignored' }] } } }),
    ).toBeNull()
  })
})
