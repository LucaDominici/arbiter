// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateAntiDriftValidators } from '../../src/generators/anti-drift-validators.js'
import { makeConfig } from '../helpers.js'

describe('generateAntiDriftValidators (INV-89, W6)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-adv-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('emits 11 scripts total', () => {
    const result = generateAntiDriftValidators(makeConfig(dir))
    expect(result.files).toHaveLength(11)
  })

  it('emits all expected script paths', () => {
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
    ]) {
      const content = readFileSync(join(dir, 'scripts', name), 'utf-8')
      expect(content).not.toContain('<%')
      expect(content).not.toContain('%>')
    }
  })
})
