// SPDX-License-Identifier: Apache-2.0
// #1817 (A5) — arbiter doctor --prove-gates: text/JSON output and exit-code wiring.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { runDoctorProveGates } from '../../src/commands/doctor.js'
import { listGateProofs } from '../../src/conformance/gate-proofs.js'

interface Captured {
  out: string
  restore: () => void
}

function captureStdout(): Captured {
  const captured: Captured = { out: '', restore: () => {} }
  const spy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      captured.out += typeof chunk === 'string' ? chunk : chunk.toString()
      return true
    })
  captured.restore = () => spy.mockRestore()
  return captured
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runDoctorProveGates — text mode', () => {
  it('prints one BITES/NO-BITE line per registered gate proof', () => {
    const captured = captureStdout()
    try {
      const result = runDoctorProveGates({})
      expect(result.results).toHaveLength(listGateProofs().length)
      for (const r of result.results) {
        expect(captured.out).toContain(r.id)
        expect(captured.out).toContain(r.bites ? '[BITES]' : '[NO-BITE]')
      }
    } finally {
      captured.restore()
    }
  })

  it('summarises how many gates did not bite when at least one fails to bite', () => {
    const captured = captureStdout()
    try {
      const result = runDoctorProveGates({})
      if (result.notBitingCount > 0) {
        expect(captured.out).toContain(
          `${result.notBitingCount} of ${result.results.length} gate(s) did NOT bite`,
        )
      } else {
        expect(captured.out).toContain('bite on their negative fixture')
      }
    } finally {
      captured.restore()
    }
  })
})

describe('runDoctorProveGates — json mode', () => {
  it('emits a single parseable JSON envelope with results/bitingCount/notBitingCount', () => {
    const captured = captureStdout()
    try {
      const result = runDoctorProveGates({ json: true })
      const parsed: unknown = JSON.parse(captured.out)
      expect(parsed).toMatchObject({
        command: 'doctor --prove-gates',
        status: result.exitCode === 0 ? 'ok' : 'error',
        data: {
          bitingCount: result.bitingCount,
          notBitingCount: result.notBitingCount,
        },
      })
    } finally {
      captured.restore()
    }
  })
})

describe('runDoctorProveGates — exit-code semantics', () => {
  it('exitCode is 1 iff at least one registered gate does not bite (0 iff all bite)', () => {
    const captured = captureStdout()
    try {
      const result = runDoctorProveGates({})
      expect(result.exitCode).toBe(result.notBitingCount > 0 ? 1 : 0)
      // D-INVARIANTS-ENFORCED is a known, documented gap (#1698 red-team RT-02): its verdict
      // ladder cannot reach 'N', so it never bites. --prove-gates correctly reports this as
      // exitCode 1 today — that is the tool doing its job (see gate-proofs.ts and the PR body),
      // not a regression to chase away by loosening the exit-code rule.
      const invariantsResult = result.results.find((r) => r.id === 'D-INVARIANTS-ENFORCED')
      expect(invariantsResult?.bites).toBe(false)
      expect(result.exitCode).toBe(1)
    } finally {
      captured.restore()
    }
  })

  it('bitingCount + notBitingCount always equals the total number of results', () => {
    const captured = captureStdout()
    try {
      const result = runDoctorProveGates({})
      expect(result.bitingCount + result.notBitingCount).toBe(result.results.length)
    } finally {
      captured.restore()
    }
  })
})
