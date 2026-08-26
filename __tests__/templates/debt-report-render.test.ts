import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import { computeMetricsProfile } from '../../src/generators/debt-ratchet.js'
import type { ProjectConfig } from '../../src/wizard/types.js'

function makeDataWithProfile(overrides: Partial<ProjectConfig>) {
  const config = makeConfig('/tmp/test', overrides)
  const metricsProfile = computeMetricsProfile(config)
  return { ...config, metricsProfile } as unknown as Record<string, unknown>
}

describe('debt-report.mjs.ejs', () => {
  for (const lang of ['typescript', 'rust', 'java', 'go', 'python'] as const) {
    it(`renders valid JS for ${lang}`, () => {
      const data = makeDataWithProfile({
        language: lang,
        enableDebtGates: true,
      })
      const rendered = renderTemplate('scripts/debt-report.mjs.ejs', data)
      expect(rendered).toContain('#!/usr/bin/env node')
      expect(rendered).toContain('debt-baseline.json')
      expect(rendered).toContain('--gate')
      expect(rendered).toContain('regressed')
    })
  }

  describe('missing baseline behavior by governance level', () => {
    it('L1: warns and exits 0 (no fail-closed)', () => {
      const data = makeDataWithProfile({
        language: 'typescript',
        governanceLevel: 'L1',
      })
      const rendered = renderTemplate('scripts/debt-report.mjs.ejs', data)
      expect(rendered).toContain('console.warn')
      expect(rendered).toContain('debt-baseline.json not found')
      expect(rendered).not.toContain('GATE FAIL: debt-baseline.json not found')
    })

    it('L2: emits console.warn to stderr and exits 0', () => {
      const data = makeDataWithProfile({
        language: 'typescript',
        governanceLevel: 'L2',
      })
      const rendered = renderTemplate('scripts/debt-report.mjs.ejs', data)
      expect(rendered).toContain('console.warn')
      expect(rendered).toContain('debt-baseline.json not found')
      expect(rendered).not.toContain('GATE FAIL: debt-baseline.json not found')
    })

    it('L3: exits with code 1 when baseline missing (fail-closed)', () => {
      const data = makeDataWithProfile({
        language: 'typescript',
        governanceLevel: 'L3',
      })
      const rendered = renderTemplate('scripts/debt-report.mjs.ejs', data)
      expect(rendered).toContain('GATE FAIL: debt-baseline.json not found')
      expect(rendered).toContain('process.exit(1)')
    })
  })

  it('contains --require-improvement flag logic', () => {
    const data = makeDataWithProfile({ language: 'typescript' })
    const rendered = renderTemplate('scripts/debt-report.mjs.ejs', data)
    expect(rendered).toContain('require-improvement')
  })

  it('keeps the self and rendered debt tolerance equal to the coverage ratchet', () => {
    const data = makeDataWithProfile({ language: 'typescript' })
    const rendered = renderTemplate('scripts/debt-report.mjs.ejs', data)
    const selfReport = readFileSync(resolve('scripts/debt-report.mjs'), 'utf-8')
    const coverageRatchet = readFileSync(resolve('scripts/check-coverage-ratchet.mjs'), 'utf-8')
    const value = (source: string, name: string): number =>
      Number(new RegExp(`const ${name} = (\\d+(?:\\.\\d+)?)`).exec(source)?.[1])

    const ratchetTolerance = value(coverageRatchet, 'TOLERANCE')
    expect(value(selfReport, 'COVERAGE_NOISE_TOLERANCE_PP')).toBe(ratchetTolerance)
    expect(value(rendered, 'COVERAGE_NOISE_TOLERANCE_PP')).toBe(ratchetTolerance)
    expect(90).toBeLessThan(90.41 - ratchetTolerance)
  })

  it('outputs a markdown table', () => {
    const data = makeDataWithProfile({ language: 'typescript' })
    const rendered = renderTemplate('scripts/debt-report.mjs.ejs', data)
    expect(rendered).toContain('| Metric |')
  })

  it('java debt-lib uses gradlew for gradle buildTool', () => {
    const data = makeDataWithProfile({
      language: 'java',
      buildTool: 'gradle',
      enableDebtGates: true,
    })
    const rendered = renderTemplate('scripts/debt-lib.mjs.ejs', data)
    expect(rendered).toContain('gradlew')
  })

  it('java debt-lib uses mvn for maven buildTool', () => {
    const data = makeDataWithProfile({
      language: 'java',
      buildTool: 'maven',
      enableDebtGates: true,
    })
    const rendered = renderTemplate('scripts/debt-lib.mjs.ejs', data)
    expect(rendered).toContain('mvn')
  })
})
