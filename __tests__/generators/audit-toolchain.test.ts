// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateAuditToolchain } from '../../src/generators/audit-toolchain.js'
import { makeConfig } from '../helpers.js'

describe('generateAuditToolchain', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-at-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('emits exactly one file', () => {
    const result = generateAuditToolchain(makeConfig(dir))
    expect(result.files).toHaveLength(1)
  })

  it('emits to scripts/audit-toolchain.mjs', () => {
    const result = generateAuditToolchain(makeConfig(dir))
    expect(result.files[0].path).toContain('scripts/audit-toolchain.mjs')
  })

  it('emitted script has a shebang line', () => {
    generateAuditToolchain(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'audit-toolchain.mjs'), 'utf-8')
    expect(content).toMatch(/^#!/)
  })

  it('emitted script checks CI workflow files when GitHub is on', () => {
    generateAuditToolchain(makeConfig(dir, { useGitHub: true }))
    const content = readFileSync(join(dir, 'scripts', 'audit-toolchain.mjs'), 'utf-8')
    expect(content).toContain('.github/workflows')
  })

  // #1835: the workflow-file assertions are useGitHub-gated — a non-GitHub project
  // would otherwise false-FAIL on workflow files that were never applicable.
  it('emitted script omits CI workflow checks when GitHub is off', () => {
    generateAuditToolchain(makeConfig(dir, { useGitHub: false }))
    const content = readFileSync(join(dir, 'scripts', 'audit-toolchain.mjs'), 'utf-8')
    expect(content).not.toContain('.github/workflows')
  })

  // #1835: check-docs.mjs is only emitted at L2+ (check-all.ts); asserting its
  // presence at L1 would false-FAIL every L1 project that opts into this audit.
  it('emitted script omits check-docs.mjs at L1', () => {
    generateAuditToolchain(makeConfig(dir, { governanceLevel: 'L1' }))
    const content = readFileSync(join(dir, 'scripts', 'audit-toolchain.mjs'), 'utf-8')
    expect(content).not.toContain('check-docs.mjs')
  })

  it('emitted script requires check-docs.mjs at L2+', () => {
    generateAuditToolchain(makeConfig(dir, { governanceLevel: 'L2' }))
    const content = readFileSync(join(dir, 'scripts', 'audit-toolchain.mjs'), 'utf-8')
    expect(content).toContain('check-docs.mjs')
  })

  it('emitted script checks gate scripts exist', () => {
    generateAuditToolchain(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'audit-toolchain.mjs'), 'utf-8')
    expect(content).toContain('check-all.mjs')
  })

  it('emitted script checks CLI buildability', () => {
    generateAuditToolchain(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'audit-toolchain.mjs'), 'utf-8')
    expect(content).toContain('build')
  })

  it('emitted script exits 1 on fail and 0 on pass', () => {
    generateAuditToolchain(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'audit-toolchain.mjs'), 'utf-8')
    // Script uses ternary: process.exit(failed > 0 ? 1 : 0)
    expect(content).toContain('process.exit(')
    expect(content).toMatch(/process\.exit\(.*\b1\b/)
    expect(content).toMatch(/process\.exit\(.*\b0\b/)
  })

  it('is idempotent (skipIfExists on second call)', () => {
    generateAuditToolchain(makeConfig(dir))
    const result2 = generateAuditToolchain(makeConfig(dir))
    expect(result2.files.every((f) => f.action === 'skipped')).toBe(true)
  })

  it('action is "created" on first call', () => {
    const result = generateAuditToolchain(makeConfig(dir))
    expect(result.files[0].action).toBe('created')
  })
})
