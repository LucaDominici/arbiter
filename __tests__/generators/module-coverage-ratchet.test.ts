// SPDX-License-Identifier: Apache-2.0
// #1457 (INV-134) — per-module coverage non-regression ratchet.
// The decision logic lives in the emitted scripts/verify-module-coverage.mjs as a pure
// `compareModuleCoverage(baseline, current, slack)` so it is unit-testable in isolation.
// Contract:
//   - module within slack (drop <= slack)            → no violation
//   - module dropped MORE than slack                 → violation
//   - module is greenfield (0 executable lines)      → no violation (PASS)
//   - module in baseline but absent from current     → violation (possible rename/deletion)
//   - first run (empty baseline)                     → no violations (seed)
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { generateCheckAll } from '../../src/generators/check-all.js'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('verify-module-coverage emission (#1457, INV-134)', () => {
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-modcov-emit-'))
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('check-all generator emits scripts/verify-module-coverage.mjs for a TS project', () => {
    const result = generateCheckAll(makeConfig(dir, { language: 'typescript' }))
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('scripts/verify-module-coverage.mjs'))).toBe(true)
  })
})

describe('compareModuleCoverage — pure ratchet (#1457)', () => {
  let mod: {
    compareModuleCoverage: (
      baseline: Record<string, number>,
      current: Record<string, number>,
      slack: number,
    ) => { violations: Array<{ module: string; reason: string }> }
  }
  let dir: string

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-modcov-eval-'))
    const rendered = renderTemplate('scripts/verify-module-coverage.mjs.ejs', {
      ...makeConfig(dir, { language: 'typescript' }),
      coverageThreshold: 80,
      coverageEnabled: true,
    } as unknown as Record<string, unknown>)
    const file = join(dir, 'verify-module-coverage.mjs')
    writeFileSync(file, rendered)
    mod = (await import(pathToFileURL(file).href)) as typeof mod
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('no violation when a module stays within slack (drop <= 0.5pp)', () => {
    const r = mod.compareModuleCoverage({ 'src/a.ts': 90 }, { 'src/a.ts': 89.6 }, 0.5)
    expect(r.violations).toHaveLength(0)
  })

  it('no violation when a module IMPROVES', () => {
    const r = mod.compareModuleCoverage({ 'src/a.ts': 80 }, { 'src/a.ts': 95 }, 0.5)
    expect(r.violations).toHaveLength(0)
  })

  it('VIOLATION when a module drops more than the slack (>0.5pp)', () => {
    const r = mod.compareModuleCoverage({ 'src/a.ts': 90 }, { 'src/a.ts': 80 }, 0.5)
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0].module).toBe('src/a.ts')
  })

  it('VIOLATION when a baselined module is absent from current coverage (rename/deletion)', () => {
    const r = mod.compareModuleCoverage({ 'src/a.ts': 90 }, {}, 0.5)
    expect(r.violations).toHaveLength(1)
  })

  it('no violation for a brand-new module not in baseline (upward-only, new code is welcome)', () => {
    const r = mod.compareModuleCoverage({}, { 'src/new.ts': 12 }, 0.5)
    expect(r.violations).toHaveLength(0)
  })

  it('first run with an empty baseline yields no violations (seed scenario)', () => {
    const r = mod.compareModuleCoverage({}, {}, 0.5)
    expect(r.violations).toHaveLength(0)
  })

  it('exactly slack drop is tolerated (boundary, no violation)', () => {
    const r = mod.compareModuleCoverage({ 'src/a.ts': 90 }, { 'src/a.ts': 89.5 }, 0.5)
    expect(r.violations).toHaveLength(0)
  })
})
