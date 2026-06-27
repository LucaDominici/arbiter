// SPDX-License-Identifier: Apache-2.0
// #1630: the canonical L1→L2 upgrade must NOT abort when the target project has
// no scripts/capture-debt-baseline.mjs (it is generated later, by `arbiter
// update`). This test deliberately does NOT mock runCli, so an unguarded
// `node scripts/capture-debt-baseline.mjs` against a missing file would raise
// MODULE_NOT_FOUND and leave the level at L1 — the regression we are fixing.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runUpgradeLevel } from '../../src/commands/upgrade-level.js'
import { loadConfig } from '../../src/utils/config.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'upgrade-baseline-guard-'))
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

function seedL1(): void {
  writeFileSync(
    join(dir, 'arbiter.json'),
    JSON.stringify({
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L1',
      useGitHub: false,
      archetype: 'library',
      architectureStyle: 'none',
      isMultiTenant: false,
      hasDatabase: false,
      hasPublicApi: false,
    }),
  )
}

describe('runUpgradeLevel — L1→L2 with no debt-baseline script (#1630)', () => {
  it('persists the level bump even though scripts/capture-debt-baseline.mjs is absent', async () => {
    seedL1()
    // Precondition: the script the old code blindly ran does not exist here.
    expect(existsSync(join(dir, 'scripts', 'capture-debt-baseline.mjs'))).toBe(false)

    await runUpgradeLevel({ dir, target: 'L2', days: 30 })

    const saved = loadConfig(dir)
    expect(saved?.governanceLevel).toBe('L2')
    expect(saved?.graceFromLevel).toBe('L1')
    expect(saved?.graceEndsAt).toBeDefined()
  })
})
