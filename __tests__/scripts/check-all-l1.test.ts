import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { matchesGlob, resolve } from 'node:path'
import integrationConfig from '../../vitest.integration.config'

const SCRIPT = resolve('scripts/check-all.mjs')
const content = readFileSync(SCRIPT, 'utf-8')
const BAKE_SUITE = '__tests__/integration/e2e/bake/fixture-bake.test.ts'

function integrationIncludePatterns(): string[] {
  const test = (integrationConfig as { test?: { include?: string[] } }).test
  return test?.include ?? []
}

function integrationSuiteArgv(): string[] {
  const step = content.match(/'integration suite \(INV-25\)'\s*,\s*'npx'\s*,\s*(\[[\s\S]*?\])/)
  expect(step, 'integration suite (INV-25) must have a static argv array').not.toBeNull()

  return [...step![1].matchAll(/['"]([^'"]+)['"]/g)].map(([, argument]) => argument!)
}

describe('check-all.mjs L1 wiring', () => {
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
    const surrounding = content.slice(idx, idx + 220)
    expect(surrounding).toContain("'vitest.integration.config.ts'")
    expect(surrounding).toContain("'--silent'")
  })

  it("the bake suite is collected by the gate's integration config", () => {
    const includePatterns = integrationIncludePatterns()

    expect(includePatterns.some((pattern) => matchesGlob(BAKE_SUITE, pattern))).toBe(true)
  })

  it('the L2 integration step runs the suite unfiltered', () => {
    const pathArguments = integrationSuiteArgv().filter((argument) =>
      argument.startsWith('__tests__/'),
    )

    expect(pathArguments).toEqual([])
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
