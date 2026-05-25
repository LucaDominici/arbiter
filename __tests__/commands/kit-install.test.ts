// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runKitInstall, type KitInstallOptions } from '../../src/commands/kit-install.js'
import { defaultConfig } from '../../src/utils/config.js'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'arbiter-kit-install-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
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
  it('returns a result with all 6 phase labels', async () => {
    const result = await runKitInstall(makeOptions())
    const phases = result.phases.map((p) => p.phase)
    expect(phases).toContain('DETECT')
    expect(phases).toContain('MEASURE')
    expect(phases).toContain('SCAFFOLD')
    expect(phases).toContain('ASSESS')
    expect(phases).toContain('PLAN')
    expect(phases).toContain('VERIFY')
  })

  it('returns ok=true for a dry-run', async () => {
    const result = await runKitInstall(makeOptions())
    expect(result.ok).toBe(true)
  })

  it('includes a wavePlan in the result', async () => {
    const result = await runKitInstall(makeOptions())
    expect(result.wavePlan).toBeDefined()
    expect(result.wavePlan!.waves).toHaveLength(4)
  })

  it('DETECT phase captures language and brownfieldClass', async () => {
    const result = await runKitInstall(
      makeOptions({ language: 'typescript', brownfieldClass: 'medium' }),
    )
    const detect = result.phases.find((p) => p.phase === 'DETECT')
    expect(detect?.output).toContain('typescript')
    expect(detect?.output).toContain('medium')
  })

  it('PLAN phase output references wave labels', async () => {
    const result = await runKitInstall(makeOptions())
    const plan = result.phases.find((p) => p.phase === 'PLAN')
    expect(plan?.output).toContain('W0')
    expect(plan?.output).toContain('W3')
  })

  it('VERIFY phase reports a coverage percentage and W1 count', async () => {
    const result = await runKitInstall(makeOptions())
    const verify = result.phases.find((p) => p.phase === 'VERIFY')
    expect(verify?.output).toMatch(/VERIFY: coverage \d+%/)
    expect(verify?.output).toMatch(/\d+ dims in W1/)
  })
})

describe('runKitInstall — SCAFFOLD phase modes', () => {
  it('scaffold phase reports no arbiter.json when directory has none', async () => {
    const result = await runKitInstall(makeOptions({ dryRun: true }))
    const scaffold = result.phases.find((p) => p.phase === 'SCAFFOLD')
    expect(scaffold?.output).toContain('no arbiter.json')
  })

  it('scaffold phase reports file counts when arbiter.json is present', async () => {
    writeFileSync(join(tmpDir, 'arbiter.json'), JSON.stringify(defaultConfig(), null, 2) + '\n')
    const result = await runKitInstall(makeOptions({ dryRun: true }))
    const scaffold = result.phases.find((p) => p.phase === 'SCAFFOLD')
    expect(scaffold?.output).toMatch(/SCAFFOLD: \d+ files/)
  })
})

describe('runKitInstall — MEASURE phase', () => {
  it('MEASURE phase output includes dim counts', async () => {
    const result = await runKitInstall(makeOptions())
    const measure = result.phases.find((p) => p.phase === 'MEASURE')
    expect(measure?.output).toContain('MEASURE:')
    expect(measure?.output).toMatch(/\d+ dims measured/)
  })
})
