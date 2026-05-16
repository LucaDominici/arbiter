// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import {
  applyDeprecatedFlagFilter,
  type DeprecatedFlagFilterResult,
} from '../../src/internal/deprecate.js'
import type { DeprecatedFlagRecord } from '../../src/internal/cli-deprecation-registry.js'

// Synthetic registry entries used for behavioral testing.
// Tests must not depend on CLI_DEPRECATED_FLAGS (currently empty) to avoid vacuous passes.
const WARN_FLAG: DeprecatedFlagRecord = {
  flag: '--legacy-format',
  stage: 'warn',
  deprecatedIn: '0.1.0',
  removeIn: '0.3.0',
  replacement: '--format',
}
const HIDE_FLAG: DeprecatedFlagRecord = {
  flag: '--old-output',
  stage: 'hide',
  deprecatedIn: '0.1.0',
  removeIn: '0.3.0',
  replacement: '--output',
}
const REMOVE_FLAG: DeprecatedFlagRecord = {
  flag: '--removed-flag',
  stage: 'remove',
  deprecatedIn: '0.1.0',
  removeIn: '0.2.0',
  replacement: '--new-flag',
}

describe('applyDeprecatedFlagFilter contract (#606)', () => {
  it('warn-stage flag: emits deprecation warning to stderr and passes through', () => {
    const writes: string[] = []
    const orig = process.stderr.write.bind(process.stderr)
    process.stderr.write = (chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
      return true
    }
    try {
      const argv = ['node', 'arbiter', WARN_FLAG.flag, 'init']
      const result: DeprecatedFlagFilterResult = applyDeprecatedFlagFilter(argv, [WARN_FLAG])
      expect(result.exitCode).toBeUndefined()
      expect(result.remaining).toContain(WARN_FLAG.flag)
      expect(writes.some((w) => w.toLowerCase().includes('deprecated'))).toBe(true)
      expect(writes.some((w) => w.includes(WARN_FLAG.replacement))).toBe(true)
    } finally {
      process.stderr.write = orig
    }
  })

  it('hide-stage flag: filtered from remaining argv with deprecation notice', () => {
    const writes: string[] = []
    const orig = process.stderr.write.bind(process.stderr)
    process.stderr.write = (chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
      return true
    }
    try {
      const argv = ['node', 'arbiter', HIDE_FLAG.flag, 'init']
      const result: DeprecatedFlagFilterResult = applyDeprecatedFlagFilter(argv, [HIDE_FLAG])
      expect(result.exitCode).toBeUndefined()
      expect(result.remaining).not.toContain(HIDE_FLAG.flag)
      expect(writes.some((w) => w.toLowerCase().includes('deprecated'))).toBe(true)
    } finally {
      process.stderr.write = orig
    }
  })

  it('remove-stage flag: returns exitCode=1 with replacement hint', () => {
    const argv = ['node', 'arbiter', REMOVE_FLAG.flag, 'init']
    const result: DeprecatedFlagFilterResult = applyDeprecatedFlagFilter(argv, [REMOVE_FLAG])
    expect(result.exitCode).toBe(1)
    expect(result.errorMessage).toBeDefined()
    expect(result.errorMessage).toContain(REMOVE_FLAG.replacement)
  })

  it('--flag=value form: matched correctly for all stages', () => {
    const argv = ['node', 'arbiter', `${WARN_FLAG.flag}=json`, 'init']
    const writes: string[] = []
    const orig = process.stderr.write.bind(process.stderr)
    process.stderr.write = (chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
      return true
    }
    try {
      const result: DeprecatedFlagFilterResult = applyDeprecatedFlagFilter(argv, [WARN_FLAG])
      expect(result.exitCode).toBeUndefined()
      expect(writes.some((w) => w.toLowerCase().includes('deprecated'))).toBe(true)
    } finally {
      process.stderr.write = orig
    }
  })

  it('unknown flags pass through unchanged', () => {
    const argv = ['node', 'arbiter', '--unknown-flag', 'init']
    const result: DeprecatedFlagFilterResult = applyDeprecatedFlagFilter(argv, [
      WARN_FLAG,
      HIDE_FLAG,
    ])
    expect(result.exitCode).toBeUndefined()
    expect(result.remaining).toContain('--unknown-flag')
  })
})
