// SPDX-License-Identifier: Apache-2.0
// CANON-05: generator unit tests for F6 k6 perf ecosystem (#895)

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generatePerfK6 } from '../../src/generators/perf-k6.js'

describe('generatePerfK6', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('returns empty files when enablePerfTesting is false', () => {
    const config = makeConfig(dir, { enablePerfTesting: false })
    const result = generatePerfK6(config)
    expect(result.files).toHaveLength(0)
  })

  it('returns empty files when enablePerfTesting is absent', () => {
    const config = makeConfig(dir, {})
    const result = generatePerfK6(config)
    expect(result.files).toHaveLength(0)
  })

  it('emits 17 files when enablePerfTesting is true (12 scenarios + 3 reports + seed + validator + 2 workflows)', () => {
    const config = makeConfig(dir, { enablePerfTesting: true })
    const result = generatePerfK6(config)
    // 2 workflows + 12 scenarios + 3 reports + 1 seed + 1 validator = 19
    expect(result.files.length).toBe(19)
  })

  it('emits 11-k6-on-demand.yml workflow', () => {
    const config = makeConfig(dir, { enablePerfTesting: true })
    generatePerfK6(config)
    expect(existsSync(join(dir, '.github', 'workflows', '11-k6-on-demand.yml'))).toBe(true)
  })

  it('emits _k6-runner.yml reusable workflow', () => {
    const config = makeConfig(dir, { enablePerfTesting: true })
    generatePerfK6(config)
    expect(existsSync(join(dir, '.github', 'workflows', '_k6-runner.yml'))).toBe(true)
  })

  it('emits all 12 scenario files', () => {
    const config = makeConfig(dir, { enablePerfTesting: true })
    generatePerfK6(config)
    const scenarios = [
      'load',
      'stress',
      'spike',
      'soak',
      'volume',
      'breakpoint',
      'smoke',
      'ramp-up',
      'ramp-down',
      'steady-state',
      'burst',
      'endurance',
    ]
    for (const name of scenarios) {
      expect(
        existsSync(join(dir, 'perf', 'k6', 'scenarios', `${name}.js`)),
        `missing scenario: ${name}.js`,
      ).toBe(true)
    }
  })

  it('emits 3 Python report generators', () => {
    const config = makeConfig(dir, { enablePerfTesting: true })
    generatePerfK6(config)
    for (const name of ['html-report.py', 'json-report.py', 'csv-report.py']) {
      expect(existsSync(join(dir, 'perf', 'k6', 'reports', name)), `missing report: ${name}`).toBe(
        true,
      )
    }
  })

  it('emits the seed SQL', () => {
    const config = makeConfig(dir, { enablePerfTesting: true })
    generatePerfK6(config)
    expect(existsSync(join(dir, 'perf', 'k6', 'seed', 'test-data.sql'))).toBe(true)
  })

  it('emits the scenario completeness validator', () => {
    const config = makeConfig(dir, { enablePerfTesting: true })
    generatePerfK6(config)
    expect(existsSync(join(dir, 'scripts', 'validate-k6-scenarios.mjs'))).toBe(true)
  })

  it('scenario files use skipIfExists (idempotent on re-run)', () => {
    const config = makeConfig(dir, { enablePerfTesting: true })
    generatePerfK6(config)
    const second = generatePerfK6(config)
    const smokeResult = second.files.find((f) => f.path.endsWith('smoke.js'))
    expect(smokeResult?.action).toBe('skipped')
  })
})
