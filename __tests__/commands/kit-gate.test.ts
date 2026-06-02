// SPDX-License-Identifier: Apache-2.0
// #1151: the kit experimental gate must fail-closed against real kit state,
// not merely check the --experimental.kit feature flag.

import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('computeKitValidation — live catalog', () => {
  it('returns severity 0 with an OK summary line on the real catalog', async () => {
    const { computeKitValidation } = await import('../../src/commands/kit.js')
    const result = computeKitValidation()
    expect(result.severity).toBe(0)
    expect(result.stdout.join('\n')).toContain('[arbiter kit validate] OK')
  })
})

describe('enforceKitGate — fail-closed contract (#1151)', () => {
  it('returns 0 and writes nothing when kit state is clean', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const { enforceKitGate } = await import('../../src/commands/kit.js')
    expect(enforceKitGate()).toBe(0)
    expect(stderrSpy).not.toHaveBeenCalled()
  })

  it('returns nonzero and reports to stderr when the catalog leaks a redacted token', async () => {
    // Force a redaction FAIL by stubbing the scanner — proves the gate reacts to
    // real kit-state violations rather than silently passing.
    vi.doMock('../../src/kit/redaction.js', () => ({
      scanForRedactedTokens: () => [{ line: 1, token: 'FAKE', lineContent: 'leak' }],
    }))
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const { enforceKitGate } = await import('../../src/commands/kit.js')
    const severity = enforceKitGate()
    expect(severity).toBeGreaterThan(0)
    const out = stderrSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(out).toContain('gate blocked')
    expect(out).toContain('redaction FAIL')
  })
})
