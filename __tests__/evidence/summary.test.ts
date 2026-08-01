import { describe, it, expect } from 'vitest'
import { validateSummarySchema } from '../../src/evidence/summary.js'

const HEAD_SHA = 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1'
const HEAD_SHA_SHORT = 'abc123d'

function makeBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    head_sha: HEAD_SHA,
    head_sha_short: HEAD_SHA_SHORT,
    obs_gate: 'PASS',
    tests: { total: 100, passed: 100, failed: 0, skipped: 0 },
    coverage: { line: 90, branch: 85 },
    mutation: { score: 75, threshold: 70 },
    security: { critical: 0, high: 0 },
    ...overrides,
  }
}

describe('validateSummarySchema (#241)', () => {
  it('accepts a body with all required fields present', () => {
    const result = validateSummarySchema(makeBody())
    expect(result.ok).toBe(true)
  })

  it('accepts a body with optional ADR-030 fields alongside required fields', () => {
    const result = validateSummarySchema(
      makeBody({
        timestamp: new Date().toISOString(),
        commit: 'abc123d',
        duration_seconds: 42,
      }),
    )
    expect(result.ok).toBe(true)
  })

  it.each([
    'head_sha',
    'head_sha_short',
    'obs_gate',
    'tests',
    'coverage',
    'mutation',
    'security',
  ] as const)('rejects body missing required field: %s', (field) => {
    const body = Object.fromEntries(Object.entries(makeBody()).filter(([k]) => k !== field))
    const result = validateSummarySchema(body)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes(field))).toBe(true)
    }
  })

  it('rejects obs_gate with invalid value', () => {
    const result = validateSummarySchema(makeBody({ obs_gate: 'UNKNOWN' }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('obs_gate'))).toBe(true)
    }
  })

  it('accepts obs_gate FAIL as valid schema value', () => {
    const result = validateSummarySchema(makeBody({ obs_gate: 'FAIL' }))
    expect(result.ok).toBe(true)
  })

  // ─── provenance (#2164) ───────────────────────────────────────────────────

  it('accepts a body with a valid provenance block', () => {
    const result = validateSummarySchema(
      makeBody({
        provenance: {
          agent_harness: 'claude-code',
          session_id: 'sess-1',
        },
      }),
    )
    expect(result.ok).toBe(true)
  })

  it('rejects a body with a malformed provenance block', () => {
    const result = validateSummarySchema(makeBody({ provenance: { unexpected_field: 'x' } }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('provenance'))).toBe(true)
    }
  })
})
