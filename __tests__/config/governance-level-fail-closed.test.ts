// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../../src/utils/config.js'
import { DEFAULT_THRESHOLDS } from '../../src/config/schema.js'
import { ConfigError } from '../../src/utils/errors.js'

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'arbiter-governance-level-'))
}

function writeConfig(dir: string, raw: unknown): void {
  writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(raw, null, 2))
}

function captureThrown(action: () => unknown): unknown {
  let thrown: unknown
  try {
    action()
  } catch (error) {
    thrown = error
  }

  return thrown
}

function expectConfigInvalid(thrown: unknown): void {
  expect(thrown).toBeInstanceOf(ConfigError)
  if (thrown instanceof ConfigError) {
    expect(thrown.code).toBe('E_CONFIG_INVALID')
  }
}

// This is the valid v2 baseline from never-brick-migration.test.ts. Individual
// fixtures below vary only governanceLevel unless they explicitly exercise its
// absent default.
const BASELINE = {
  version: '0.2',
  governanceLevel: 'L2',
  tools: ['claude', 'codex'],
  permitGitHub: false,
  features: {
    contractTesting: false,
    mutationTesting: true,
    securityScanning: true,
    evidenceHarness: false,
    debtGates: true,
    suppressions: true,
  },
  thresholds: DEFAULT_THRESHOLDS.L2,
}

describe('governanceLevel is fail-closed', () => {
  let dir: string

  beforeEach(() => {
    dir = tmpDir()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects a numeric v2 governanceLevel without rewriting arbiter.json', () => {
    writeConfig(dir, { ...BASELINE, governanceLevel: 42 })
    const path = join(dir, 'arbiter.json')
    const before = readFileSync(path)
    const thrown = captureThrown(() => loadConfig(dir))

    expect(readFileSync(path)).toEqual(before)
    expectConfigInvalid(thrown)
  })

  it('rejects an unrecognized string v2 governanceLevel', () => {
    writeConfig(dir, { ...BASELINE, governanceLevel: 'L99' })

    expectConfigInvalid(captureThrown(() => loadConfig(dir)))
  })

  it('defaults an absent governanceLevel to L2', () => {
    writeConfig(dir, {
      version: '0.2',
      tools: ['claude', 'codex'],
      permitGitHub: false,
      features: BASELINE.features,
      thresholds: BASELINE.thresholds,
    })

    expect(loadConfig(dir)?.governanceLevel).toBe('L2')
  })

  it('continues to reject syntactically invalid arbiter.json', () => {
    writeFileSync(join(dir, 'arbiter.json'), '{not valid json')

    expectConfigInvalid(captureThrown(() => loadConfig(dir)))
  })

  it('rejects a numeric governanceLevel while migrating v1', () => {
    writeConfig(dir, {
      version: '0.1',
      governanceLevel: 42,
      tools: ['claude', 'codex'],
      useGitHub: false,
    })

    expectConfigInvalid(captureThrown(() => loadConfig(dir)))
  })

  it('defaults an absent governanceLevel while migrating v1', () => {
    writeConfig(dir, {
      version: '0.1',
      tools: ['claude', 'codex'],
      useGitHub: false,
    })

    expect(loadConfig(dir)?.governanceLevel).toBe('L2')
  })
})
