// SPDX-License-Identifier: Apache-2.0
// #1643: a scaffold/generator failure during `arbiter kit install` must make
// runKitInstall return ok:false and carry the per-failure messages in
// generatorErrors (not swallow them and report success). The registry is mocked
// here in isolation so a deterministic generator failure can be injected without
// depending on a real broken config.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { defaultConfig } from '../helpers/default-config.js'

vi.mock('../../src/generators/registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/generators/registry.js')>()
  return {
    ...actual,
    // Push a failure into the shared `errors` accumulator, mirroring how the real
    // registry records a generator that threw, then return no write results.
    runGeneratorsFromRegistry: vi.fn(
      (_specs: unknown, errors: Array<{ key: string; message: string }>) => {
        errors.push({ key: 'test-pyramid', message: 'boom: levels undefined' })
        return []
      },
    ),
  }
})

import { runKitInstall, type KitInstallOptions } from '../../src/commands/kit-install.js'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'arbiter-kit-install-fail-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  vi.clearAllMocks()
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

describe('runKitInstall — scaffold failure is fail-closed (#1643)', () => {
  beforeEach(() => {
    writeFileSync(join(tmpDir, 'arbiter.json'), JSON.stringify(defaultConfig(), null, 2) + '\n')
  })

  it('returns ok:false when a generator fails during SCAFFOLD', async () => {
    const result = await runKitInstall(makeOptions())
    expect(result.ok).toBe(false)
  })

  it('carries the per-failure messages in generatorErrors', async () => {
    const result = await runKitInstall(makeOptions())
    expect(result.generatorErrors).toBeDefined()
    expect(result.generatorErrors).toContain('test-pyramid: boom: levels undefined')
  })

  it('names the failing generator in the SCAFFOLD phase line', async () => {
    const result = await runKitInstall(makeOptions())
    const scaffold = result.phases.find((p) => p.phase === 'SCAFFOLD')
    expect(scaffold?.output).toContain('generator(s) failed: test-pyramid')
  })
})
