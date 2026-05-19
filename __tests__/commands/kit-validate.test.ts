// SPDX-License-Identifier: Apache-2.0
// Tests for runKitValidate() — schema, parity, redaction, aggregation, flag guard.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { runKitValidate } from '../../src/commands/kit.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function withKitFlag(fn: () => void): void {
  const prev = process.env['ARBITER_EXPERIMENTAL']
  process.env['ARBITER_EXPERIMENTAL'] = JSON.stringify({ kit: true })
  try {
    fn()
  } finally {
    if (prev === undefined) delete process.env['ARBITER_EXPERIMENTAL']
    else process.env['ARBITER_EXPERIMENTAL'] = prev
  }
}

function withoutKitFlag(fn: () => void): void {
  const prev = process.env['ARBITER_EXPERIMENTAL']
  process.env['ARBITER_EXPERIMENTAL'] = JSON.stringify({})
  try {
    fn()
  } finally {
    if (prev === undefined) delete process.env['ARBITER_EXPERIMENTAL']
    else process.env['ARBITER_EXPERIMENTAL'] = prev
  }
}

// ─── Flag guard ───────────────────────────────────────────────────────────────

describe('runKitValidate — flag guard', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: string | number | null) => {
      throw new Error(`exit:${String(_code)}`)
    })
  })

  afterEach(() => {
    stderrSpy.mockRestore()
    exitSpy.mockRestore()
  })

  it('exits 1 and prints error when --experimental.kit absent', () => {
    withoutKitFlag(() => {
      expect(() => runKitValidate()).toThrow('exit:1')
    })
    const stderrOutput = stderrSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(stderrOutput).toContain('--experimental.kit')
  })
})

// ─── Happy path (live catalog + mapping) ─────────────────────────────────────

describe('runKitValidate — happy path with live data', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>
  let exitSpy: ReturnType<typeof vi.spyOn>
  let exitCode: number | undefined

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      exitCode = Number(code)
      throw new Error(`exit:${String(code)}`)
    })
    exitCode = undefined
  })

  afterEach(() => {
    stdoutSpy.mockRestore()
    exitSpy.mockRestore()
  })

  it('exits 0 when catalog valid, parity OK, no redaction', () => {
    withKitFlag(() => {
      try {
        runKitValidate()
      } catch {
        // exit() throws in test
      }
    })
    expect(exitCode).toBe(0)
    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(output).toContain('[arbiter kit validate] OK')
    expect(output).toContain('76 dims')
  })
})

// ─── derived.json NOT required for validate ───────────────────────────────────

describe('runKitValidate — no build prerequisite', () => {
  it('is a zero-arity function (takes no args, does not require derived.json path)', () => {
    expect(typeof runKitValidate).toBe('function')
    expect(runKitValidate.length).toBe(0)
  })
})
