// SPDX-License-Identifier: Apache-2.0
// #1319.8 — greenfield coverage guard. A virgin TS project has zero executable
// statements; running `vitest --coverage` against an empty src tree yields a
// coverage-summary with total.statements.total === 0. Enforcing a line threshold
// then false-fails the self-gate. The guard MUST:
//   - statements.total === 0           → PASS  ("no executable statements (greenfield)")
//   - statements.total  >  0           → enforce the threshold (low % FAILS)
//   - summary missing / coverage error → FAIL  (NOT skip — a crashed coverage run
//                                                must never false-green)
// The decision logic lives in the emitted scripts/lib/coverage-gate.mjs as a pure
// `evaluateCoverageGate(summary, threshold)` so it is unit-testable in isolation.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { generateCheckAll } from '../../src/generators/check-all.js'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig, renderCheckAll } from '../helpers.js'

describe('coverage greenfield guard — emission (#1319.8)', () => {
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-cov-guard-'))
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('check-all generator emits scripts/lib/coverage-gate.mjs for a TS project', () => {
    const result = generateCheckAll(makeConfig(dir, { language: 'typescript' }))
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('scripts/lib/coverage-gate.mjs'))).toBe(true)
  })

  it('check-all.mjs runs vitest with json-summary reporter and reads coverage-summary.json', () => {
    const rendered = renderCheckAll({
      ...makeConfig('/tmp', { language: 'typescript' }),
      coverageThreshold: 80,
      coverageEnabled: true,
    } as unknown as Record<string, unknown>)
    // The coverage step must request a parseable summary and consult the guard.
    expect(rendered).toContain('json-summary')
    expect(rendered).toContain('coverage-summary.json')
    expect(rendered).toContain('evaluateCoverageGate')
  })

  it('vitest.config.ts.ejs adds json-summary to reporters so the summary is written', () => {
    const rendered = renderTemplate('coverage/vitest.config.ts.ejs', {
      ...makeConfig('/tmp', { language: 'typescript', enableDebtGates: true }),
      coverageThreshold: 80,
      coverageEnabled: true,
    } as unknown as Record<string, unknown>)
    expect(rendered).toContain('json-summary')
    // thresholdAutoUpdate:false must remain untouched (#353).
    expect(rendered).toContain('thresholdAutoUpdate: false')
  })
})

describe('evaluateCoverageGate — runtime predicate (#1319.8)', () => {
  // Render the lib, write it to disk, and import it as an ESM module so we test
  // the actual emitted logic (not a re-implementation).
  let mod: {
    evaluateCoverageGate: (
      summary: unknown,
      threshold: number,
    ) => { status: 'PASS' | 'FAIL'; reason: string }
  }
  let dir: string

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-cov-eval-'))
    const rendered = renderTemplate('scripts/lib/coverage-gate.mjs.ejs', {
      ...makeConfig(dir, { language: 'typescript' }),
      coverageThreshold: 80,
      coverageEnabled: true,
    } as unknown as Record<string, unknown>)
    const file = join(dir, 'coverage-gate.mjs')
    writeFileSync(file, rendered)
    mod = (await import(pathToFileURL(file).href)) as typeof mod
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('PASSES (greenfield) when total.statements.total === 0', () => {
    const summary = { total: { statements: { total: 0, covered: 0, pct: 0 } } }
    const r = mod.evaluateCoverageGate(summary, 80)
    expect(r.status).toBe('PASS')
    expect(r.reason).toMatch(/greenfield|no executable statements/i)
  })

  it('FAILS when statements.total > 0 but coverage is below threshold (0% covered)', () => {
    const summary = {
      total: {
        statements: { total: 100, covered: 0, pct: 0 },
        lines: { total: 100, covered: 0, pct: 0 },
      },
    }
    const r = mod.evaluateCoverageGate(summary, 80)
    expect(r.status).toBe('FAIL')
  })

  it('PASSES when statements.total > 0 and coverage meets threshold', () => {
    const summary = {
      total: {
        statements: { total: 100, covered: 95, pct: 95 },
        lines: { total: 100, covered: 95, pct: 95 },
      },
    }
    const r = mod.evaluateCoverageGate(summary, 80)
    expect(r.status).toBe('PASS')
  })

  it('FAILS (not skip) when the summary is null/undefined (coverage run errored / no summary)', () => {
    expect(mod.evaluateCoverageGate(null, 80).status).toBe('FAIL')
    expect(mod.evaluateCoverageGate(undefined, 80).status).toBe('FAIL')
  })

  it('FAILS (not skip) when the summary lacks total.statements (malformed)', () => {
    expect(mod.evaluateCoverageGate({ total: {} }, 80).status).toBe('FAIL')
    expect(mod.evaluateCoverageGate({}, 80).status).toBe('FAIL')
  })

  it('the emitted lib actually exists on disk (sanity)', () => {
    expect(existsSync(join(dir, 'coverage-gate.mjs'))).toBe(true)
    expect(readFileSync(join(dir, 'coverage-gate.mjs'), 'utf-8')).toContain('evaluateCoverageGate')
  })
})
