// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runKitInstall, type KitInstallOptions } from '../../src/commands/kit-install.js'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'arbiter-kit-install-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function makeOptions(overrides: Partial<KitInstallOptions> = {}): KitInstallOptions {
  return {
    targetDir: tmpDir,
    language: 'java',
    brownfieldClass: 'gold',
    dryRun: true,
    ...overrides,
  }
}

describe('runKitInstall — happy path (dryRun=true)', () => {
  it('returns a result with all 6 phase labels', () => {
    const result = runKitInstall(makeOptions())
    const phases = result.phases.map((p) => p.phase)
    expect(phases).toContain('DETECT')
    expect(phases).toContain('MEASURE')
    expect(phases).toContain('SCAFFOLD')
    expect(phases).toContain('ASSESS')
    expect(phases).toContain('PLAN')
    expect(phases).toContain('VERIFY')
  })

  it('returns ok=true for a dry-run', () => {
    const result = runKitInstall(makeOptions())
    expect(result.ok).toBe(true)
  })

  it('includes a wavePlan in the result', () => {
    const result = runKitInstall(makeOptions())
    expect(result.wavePlan).toBeDefined()
    expect(result.wavePlan!.waves).toHaveLength(4)
  })

  it('DETECT phase captures language and brownfieldClass', () => {
    const result = runKitInstall(makeOptions({ language: 'typescript', brownfieldClass: 'medium' }))
    const detect = result.phases.find((p) => p.phase === 'DETECT')
    expect(detect?.output).toContain('typescript')
    expect(detect?.output).toContain('medium')
  })

  it('PLAN phase output references wave labels', () => {
    const result = runKitInstall(makeOptions())
    const plan = result.phases.find((p) => p.phase === 'PLAN')
    expect(plan?.output).toContain('W0')
    expect(plan?.output).toContain('W3')
  })
})

describe('runKitInstall — non-dryRun skips scaffold writes', () => {
  it('scaffold phase reports dryRun mode when dryRun=true', () => {
    const result = runKitInstall(makeOptions({ dryRun: true }))
    const scaffold = result.phases.find((p) => p.phase === 'SCAFFOLD')
    expect(scaffold?.output).toContain('dry-run')
  })
})
