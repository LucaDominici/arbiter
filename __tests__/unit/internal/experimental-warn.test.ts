// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach } from 'vitest'
import { warnExperimental, _resetWarned } from '../../../src/internal/experimental-warn.js'

describe('warnExperimental (#601)', () => {
  beforeEach(() => {
    _resetWarned()
  })

  it('emits a warning to stderr on first call', () => {
    const writes: string[] = []
    const orig = process.stderr.write.bind(process.stderr)
    process.stderr.write = (chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
      return true
    }
    try {
      warnExperimental('my-experiment')
      expect(writes).toHaveLength(1)
      expect(writes[0]).toContain('my-experiment')
      expect(writes[0]).toContain('experimental')
    } finally {
      process.stderr.write = orig
    }
  })

  it('does not emit a second warning for the same name', () => {
    const writes: string[] = []
    const orig = process.stderr.write.bind(process.stderr)
    process.stderr.write = (chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
      return true
    }
    try {
      warnExperimental('my-experiment')
      warnExperimental('my-experiment')
      expect(writes).toHaveLength(1)
    } finally {
      process.stderr.write = orig
    }
  })

  it('emits separate warnings for distinct names', () => {
    const writes: string[] = []
    const orig = process.stderr.write.bind(process.stderr)
    process.stderr.write = (chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
      return true
    }
    try {
      warnExperimental('exp-a')
      warnExperimental('exp-b')
      expect(writes).toHaveLength(2)
    } finally {
      process.stderr.write = orig
    }
  })
})
