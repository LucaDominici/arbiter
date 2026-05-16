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
