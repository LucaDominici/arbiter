// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import {
  CLI_DEPRECATED_FLAGS,
  type DeprecatedFlagRecord,
} from '../../../src/internal/cli-deprecation-registry.js'

describe('CLI_DEPRECATED_FLAGS registry (#606)', () => {
  it('is an array', () => {
    expect(Array.isArray(CLI_DEPRECATED_FLAGS)).toBe(true)
  })

  it('each entry has required fields with correct types', () => {
    for (const entry of CLI_DEPRECATED_FLAGS) {
      expect(typeof entry.flag).toBe('string')
      expect(['warn', 'hide', 'remove']).toContain(entry.stage)
      expect(typeof entry.deprecatedIn).toBe('string')
      expect(typeof entry.removeIn).toBe('string')
      expect(typeof entry.replacement).toBe('string')
    }
  })

  it('deprecatedIn and removeIn are distinct (must have at least one MINOR gap)', () => {
    for (const entry of CLI_DEPRECATED_FLAGS) {
      expect(entry.deprecatedIn).not.toBe(entry.removeIn)
    }
  })

  it('flag names are unique across the registry', () => {
    const seen = new Set<string>()
    for (const entry of CLI_DEPRECATED_FLAGS) {
      expect(seen.has(entry.flag)).toBe(false)
      seen.add(entry.flag)
    }
  })
})

// #2453: `update`'s `--no-adopt-gate-spine` / `--no-adopt-governance` were
// permanent no-ops living entirely OUTSIDE this registry — accepted by
// commander, doing nothing, with no warning and no removal window. AC-1
// requires each to either do what it says or enter this registry with a warn
// stage and a real removal window. They are obsolete (the behavior they name
// — withhold — is already the unconditional default since #2119/#2141, so
// there is nothing left for a negation to opt into), so: deprecate.
describe('#2453: --no-adopt-gate-spine / --no-adopt-governance are registered, not silent', () => {
  function entryFor(flag: string): DeprecatedFlagRecord {
    const entry = CLI_DEPRECATED_FLAGS.find((e) => e.flag === flag)
    if (entry === undefined) {
      throw new Error(`expected CLI_DEPRECATED_FLAGS to contain an entry for "${flag}"`)
    }
    return entry
  }

  it('--no-adopt-gate-spine is registered at warn stage with a real removal version', () => {
    const entry = entryFor('--no-adopt-gate-spine')
    expect(entry.stage).toBe('warn')
    expect(entry.deprecatedIn).toMatch(/^\d+\.\d+\.\d+$/)
    expect(entry.removeIn).toMatch(/^\d+\.\d+\.\d+$/)
    expect(entry.removeIn).not.toBe(entry.deprecatedIn)
  })

  it('--no-adopt-governance is registered at warn stage with a real removal version', () => {
    const entry = entryFor('--no-adopt-governance')
    expect(entry.stage).toBe('warn')
    expect(entry.deprecatedIn).toMatch(/^\d+\.\d+\.\d+$/)
    expect(entry.removeIn).toMatch(/^\d+\.\d+\.\d+$/)
    expect(entry.removeIn).not.toBe(entry.deprecatedIn)
  })
})

describe('DeprecatedFlagRecord type shape (#606)', () => {
  it('compiles with all required fields', () => {
    const sample: DeprecatedFlagRecord = {
      flag: '--test-flag',
      stage: 'warn',
      deprecatedIn: '0.1.0',
      removeIn: '0.3.0',
      replacement: '--new-flag',
    }
    expect(sample.flag).toBe('--test-flag')
  })
})
