// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateAntiDriftValidators } from '../../src/generators/anti-drift-validators.js'
import { makeConfig } from '../helpers.js'

describe('generateAntiDriftValidators (INV-89, W6+F4)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-adv-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('emits 20 scripts total (11 W6 + 9 F4)', () => {
    const result = generateAntiDriftValidators(makeConfig(dir))
    expect(result.files).toHaveLength(20)
  })

  it('emits all W6 script paths', () => {
    const result = generateAntiDriftValidators(makeConfig(dir))
    const paths = result.files.map((f) => f.path)
    const expected = [
      'check-suppression-rationale.mjs',
      'check-suppression-expiry.mjs',
      'check-pii-scan.mjs',
      'check-secret-scan.mjs',
      'check-drift.mjs',
      'check-workflow-runners.mjs',
      'check-workflow-docs-sync.mjs',
      'check-workflow-test-integrity.mjs',
      'check-pr-size-gate.mjs',
      'check-workflow-sha-pinning.mjs',
      'check-workflow-job-naming.mjs',
    ]
    for (const name of expected) {
      expect(paths.some((p) => p.endsWith(name))).toBe(true)
    }
  })

  it('emits all F4 script paths', () => {
    const result = generateAntiDriftValidators(makeConfig(dir))
    const paths = result.files.map((f) => f.path)
    const f4Expected = [
      'check-validator-helptext.mjs',
      'check-tier-coverage.mjs',
      'check-inline-suppressions.mjs',
      'check-suppressions.mjs',
      'check-action-pins.mjs',
      'check-workflow-perms.mjs',
      'check-exit-code-contract.mjs',
      'check-ssot-core.mjs',
      'check-ci-tiers.mjs',
    ]
    for (const name of f4Expected) {
      expect(paths.some((p) => p.endsWith(name))).toBe(true)
    }
  })

  it('all emitted files have action=created on first call', () => {
    const result = generateAntiDriftValidators(makeConfig(dir))
    expect(result.files.every((f) => f.action === 'created')).toBe(true)
  })

  it('is idempotent (skipIfExists on second call)', () => {
    generateAntiDriftValidators(makeConfig(dir))
    const result2 = generateAntiDriftValidators(makeConfig(dir))
    expect(result2.files.every((f) => f.action === 'skipped')).toBe(true)
  })

  it('each emitted script has a shebang line', () => {
    generateAntiDriftValidators(makeConfig(dir))
    for (const name of [
      'check-suppression-rationale.mjs',
      'check-drift.mjs',
      'check-workflow-sha-pinning.mjs',
    ]) {
      const content = readFileSync(join(dir, 'scripts', name), 'utf-8')
      expect(content).toMatch(/^#!/)
    }
  })

  it('each emitted script contains --help support', () => {
    generateAntiDriftValidators(makeConfig(dir))
    for (const name of [
      'check-suppression-rationale.mjs',
      'check-suppression-expiry.mjs',
      'check-pii-scan.mjs',
      'check-secret-scan.mjs',
      'check-drift.mjs',
      'check-workflow-runners.mjs',
      'check-workflow-docs-sync.mjs',
      'check-workflow-test-integrity.mjs',
      'check-pr-size-gate.mjs',
      'check-workflow-sha-pinning.mjs',
      'check-workflow-job-naming.mjs',
      'check-validator-helptext.mjs',
      'check-tier-coverage.mjs',
      'check-inline-suppressions.mjs',
      'check-suppressions.mjs',
      'check-action-pins.mjs',
      'check-workflow-perms.mjs',
      'check-exit-code-contract.mjs',
      'check-ssot-core.mjs',
      'check-ci-tiers.mjs',
    ]) {
      const content = readFileSync(join(dir, 'scripts', name), 'utf-8')
      expect(content).toContain('--help')
    }
  })

  it('each emitted script cites INV-89', () => {
    generateAntiDriftValidators(makeConfig(dir))
    for (const name of [
      'check-suppression-rationale.mjs',
      'check-secret-scan.mjs',
      'check-workflow-sha-pinning.mjs',
    ]) {
      const content = readFileSync(join(dir, 'scripts', name), 'utf-8')
      expect(content).toContain('INV-89')
    }
  })

  it('check-suppression-rationale: skips when no suppressions/ dir', () => {
    generateAntiDriftValidators(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'check-suppression-rationale.mjs'), 'utf-8')
    expect(content).toContain('SKIP')
    expect(content).toContain('suppressions/')
  })

  it('check-drift: skips when no drift manifest', () => {
    generateAntiDriftValidators(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'check-drift.mjs'), 'utf-8')
    expect(content).toContain('SKIP')
    expect(content).toContain('drift-manifest.json')
  })

  it('check-workflow-sha-pinning: validates 40-char hex SHA references', () => {
    generateAntiDriftValidators(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'check-workflow-sha-pinning.mjs'), 'utf-8')
    expect(content).toContain('[0-9a-f]{40}')
  })

  it('check-workflow-job-naming: validates name: field presence', () => {
    generateAntiDriftValidators(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'check-workflow-job-naming.mjs'), 'utf-8')
    expect(content).toContain('name:')
    expect(content).toContain('has no name: field')
  })

  // RED test: registry integration (#1148 Slice C)
  it('buildRegistry includes anti-drift-validators spec [WIRING #1148]', async () => {
    const { buildRegistry } = await import('../../src/generators/registry.js')
    const specs = buildRegistry(makeConfig(dir))
    const spec = specs.find((s) => s.key === 'anti-drift-validators')
    expect(spec).toBeDefined()
    expect(spec?.enabled).toBe(true)
  })

  it('no EJS tag leaks in any emitted script', () => {
    generateAntiDriftValidators(makeConfig(dir))
    for (const name of [
      'check-suppression-rationale.mjs',
      'check-suppression-expiry.mjs',
      'check-pii-scan.mjs',
      'check-secret-scan.mjs',
      'check-drift.mjs',
      'check-workflow-runners.mjs',
      'check-workflow-docs-sync.mjs',
      'check-workflow-test-integrity.mjs',
      'check-pr-size-gate.mjs',
      'check-workflow-sha-pinning.mjs',
      'check-workflow-job-naming.mjs',
      'check-validator-helptext.mjs',
      'check-tier-coverage.mjs',
      'check-inline-suppressions.mjs',
      'check-suppressions.mjs',
      'check-action-pins.mjs',
      'check-workflow-perms.mjs',
      'check-exit-code-contract.mjs',
      'check-ssot-core.mjs',
      'check-ci-tiers.mjs',
    ]) {
      const content = readFileSync(join(dir, 'scripts', name), 'utf-8')
      expect(content).not.toContain('<%')
      expect(content).not.toContain('%>')
    }
  })
})
