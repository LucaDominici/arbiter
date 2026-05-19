// SPDX-License-Identifier: Apache-2.0
// CANON-11: brownfield tests for F6 k6 perf ecosystem generator (#895)

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generatePerfK6 } from '../../src/generators/perf-k6.js'

describe('brownfield: F6 k6 perf ecosystem (CANON-11, #895)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  const baseConfig = () =>
    makeConfig(dir, {
      language: 'typescript' as const,
      archetype: 'backend-web-db' as const,
      projectName: 'my-service',
      governanceLevel: 'L2' as const,
      enablePerfTesting: true,
      useGitHub: true,
    })

  it('generates all expected files on first run', () => {
    const config = baseConfig()
    const result = generatePerfK6(config)
    expect(result.files.length).toBeGreaterThan(0)
  })

  it('emits the on-demand workflow', () => {
    const config = baseConfig()
    generatePerfK6(config)
    const wfPath = join(dir, '.github', 'workflows', '11-k6-on-demand.yml')
    expect(existsSync(wfPath)).toBe(true)
  })

  it('emits the k6-runner reusable workflow', () => {
    const config = baseConfig()
    generatePerfK6(config)
    const runnerPath = join(dir, '.github', 'workflows', '_k6-runner.yml')
    expect(existsSync(runnerPath)).toBe(true)
  })

  it('emits the scenario completeness validator', () => {
    const config = baseConfig()
    generatePerfK6(config)
    const validatorPath = join(dir, 'scripts', 'validate-k6-scenarios.mjs')
    expect(existsSync(validatorPath)).toBe(true)
  })

  it('emits at least one scenario file', () => {
    const config = baseConfig()
    generatePerfK6(config)
    const smokePath = join(dir, 'perf', 'k6', 'scenarios', 'smoke.js')
    expect(existsSync(smokePath)).toBe(true)
  })

  it('emits the html report generator', () => {
    const config = baseConfig()
    generatePerfK6(config)
    const reportPath = join(dir, 'perf', 'k6', 'reports', 'html-report.py')
    expect(existsSync(reportPath)).toBe(true)
  })

  it('emits the seed SQL', () => {
    const config = baseConfig()
    generatePerfK6(config)
    const seedPath = join(dir, 'perf', 'k6', 'seed', 'test-data.sql')
    expect(existsSync(seedPath)).toBe(true)
  })

  it('does not overwrite existing scenario file on re-run (skipIfExists)', () => {
    const config = baseConfig()
    generatePerfK6(config)
    const smokePath = join(dir, 'perf', 'k6', 'scenarios', 'smoke.js')
    writeFileSync(smokePath, '// custom content')
    generatePerfK6(config)
    const content = readFileSync(smokePath, 'utf-8')
    expect(content).toContain('custom content')
  })

  it('emits nothing when enablePerfTesting is false', () => {
    const config = makeConfig(dir, {
      language: 'typescript' as const,
      archetype: 'backend-web-db' as const,
      projectName: 'my-service',
      governanceLevel: 'L2' as const,
      enablePerfTesting: false,
    })
    const result = generatePerfK6(config)
    expect(result.files).toHaveLength(0)
  })

  it('emits nothing when enablePerfTesting is absent', () => {
    const config = makeConfig(dir, {
      language: 'typescript' as const,
      archetype: 'backend-web-db' as const,
      projectName: 'my-service',
      governanceLevel: 'L2' as const,
    })
    const result = generatePerfK6(config)
    expect(result.files).toHaveLength(0)
  })
})
