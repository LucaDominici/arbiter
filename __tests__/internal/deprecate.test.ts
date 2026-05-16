// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('warnDeprecated', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('emits a warning to stderr on first call', async () => {
    const { warnDeprecated } = await import('../../src/internal/deprecate.js')
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      warnDeprecated('oldFlag', 'v2.0.0')
      expect(spy).toHaveBeenCalledOnce()
      const output = String(spy.mock.calls[0][0])
      expect(output).toContain('oldFlag')
      expect(output).toContain('v2.0.0')
      expect(output).toContain('DEPRECATED')
    } finally {
      spy.mockRestore()
    }
  })

  it('emits warning only once for the same symbol (memoized)', async () => {
    const { warnDeprecated } = await import('../../src/internal/deprecate.js')
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      warnDeprecated('onceSymbol', 'v3.0.0')
      warnDeprecated('onceSymbol', 'v3.0.0')
      warnDeprecated('onceSymbol', 'v3.0.0')
      expect(spy).toHaveBeenCalledOnce()
    } finally {
      spy.mockRestore()
    }
  })

  it('emits separate warnings for different symbols', async () => {
    const { warnDeprecated } = await import('../../src/internal/deprecate.js')
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      warnDeprecated('symA', 'v2.0.0')
      warnDeprecated('symB', 'v2.0.0')
      expect(spy).toHaveBeenCalledTimes(2)
    } finally {
      spy.mockRestore()
    }
  })
})
