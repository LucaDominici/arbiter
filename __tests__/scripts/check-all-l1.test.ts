import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { matchesGlob, resolve } from 'node:path'
import integrationConfig from '../../vitest.integration.config'
import { integrationSuiteArgs } from '../../scripts/check-all.mjs'

const SCRIPT = resolve('scripts/check-all.mjs')
const content = readFileSync(SCRIPT, 'utf-8')
const BAKE_SUITE = '__tests__/integration/e2e/bake/fixture-bake.test.ts'

function integrationIncludePatterns(): string[] {
  const test = (integrationConfig as { test?: { include?: string[] } }).test
  return test?.include ?? []
}

describe('check-all.mjs L1 wiring', () => {
  it('keeps the complete unit corpus in L1 while L2/L3 use coverage as the single corpus run (#2605)', () => {
    const unitIdx = content.indexOf("runCheck('unit tests'")
    const coverageIdx = content.indexOf("runCheck('coverage'")
    const unitGuardIdx = content.lastIndexOf("if (subcommand === 'check')", unitIdx)
    const coverageGuardIdx = content.lastIndexOf("if (subcommand !== 'check')", coverageIdx)

    expect(unitIdx).toBeGreaterThan(-1)
    expect(unitGuardIdx).toBeGreaterThan(-1)
    expect(unitGuardIdx).toBeLessThan(unitIdx)
    expect(coverageIdx).toBeGreaterThan(-1)
    expect(coverageGuardIdx).toBeGreaterThan(-1)
    expect(coverageGuardIdx).toBeLessThan(coverageIdx)
    expect(content.slice(coverageIdx, coverageIdx + 240)).toContain('failOnSkip: true')
    const ratchetIdx = content.indexOf("runCheck('coverage ratchet (#1483)'")
    expect(ratchetIdx).toBeGreaterThan(coverageIdx)
    expect(content.slice(ratchetIdx, ratchetIdx + 180)).toContain("'--require-data'")
  })

  it('invokes check-matrix-fixtures.mjs in L1 block (#179)', () => {
    const gateBlockIdx = content.indexOf('// ─── gate: T1+T2 extended checks')
    const matrixIdx = content.indexOf('check-matrix-fixtures.mjs')
    expect(matrixIdx).toBeGreaterThan(-1)
    expect(matrixIdx).toBeLessThan(gateBlockIdx)
  })

  it("matrix fixtures step uses 'node' runner (#179)", () => {
    const idx = content.indexOf('check-matrix-fixtures.mjs')
    expect(idx).toBeGreaterThan(-1)
    const surrounding = content.slice(Math.max(0, idx - 100), idx)
    expect(surrounding).toMatch(/['"]node['"]/)
  })

  it('runs the self L2 integration suite with bounded Vitest output', () => {
    const idx = content.indexOf("'integration suite (INV-25)'")
    expect(idx).toBeGreaterThan(-1)
    const surrounding = JSON.stringify(integrationSuiteArgs([]))
    expect(surrounding).toContain('vitest.integration.config.ts')
    expect(surrounding).toContain('--silent')
  })

  it("the bake suite is collected by the gate's integration config", () => {
    const includePatterns = integrationIncludePatterns()

    expect(includePatterns.some((pattern) => matchesGlob(BAKE_SUITE, pattern))).toBe(true)
  })

  it('excludes only the smoke suite after its PASS in this run', () => {
    const args = integrationSuiteArgs([{ name: 'greenfield smoke', status: 'PASS' }])
    expect(args).toEqual([
      'vitest',
      'run',
      '--config',
      'vitest.integration.config.ts',
      '--silent',
      '--exclude',
      '__tests__/integration/init-greenfield-smoke.test.ts',
    ])
    expect(content).toContain('integrationSuiteArgs(getResults())')
  })

  it.each(['FAIL', 'SKIP', 'WARN', 'TIMEOUT'])('keeps smoke after %s', (status) => {
    expect(integrationSuiteArgs([{ name: 'greenfield smoke', status }])).not.toContain('--exclude')
  })

  it('keeps smoke when there is no same-run result or another check passed', () => {
    expect(integrationSuiteArgs([])).not.toContain('--exclude')
    expect(integrationSuiteArgs([{ name: 'unit tests', status: 'PASS' }])).not.toContain(
      '--exclude',
    )
  })

  it('check-all.mjs records why the bake golden masters are L2-only, not L1', () => {
    const l1BoundaryIdx = content.indexOf('const l1EndIdx')
    const integrationStepIdx = content.indexOf("'integration suite (INV-25)'")
    expect(l1BoundaryIdx).toBeGreaterThan(-1)
    expect(integrationStepIdx).toBeGreaterThan(l1BoundaryIdx)
    const l1L2Boundary = content.slice(l1BoundaryIdx, integrationStepIdx)

    expect(l1L2Boundary).toContain('e2e/bake/fixture-bake.test.ts')
    expect(l1L2Boundary).toContain('L1')
  })
})
