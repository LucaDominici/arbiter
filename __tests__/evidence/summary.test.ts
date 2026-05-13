import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computeSummarySha } from '../../src/risk/sha-check.js'
import { validateSummarySchema, verifySummary } from '../../src/evidence/summary.js'

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

function makeSummary(overrides: Record<string, unknown> = {}): {
  body: Record<string, unknown>
  serialised: string
} {
  const body = makeBody(overrides)
  const sha = computeSummarySha(body)
  const finalBody = { ...body, sha }
  return { body: finalBody, serialised: JSON.stringify(finalBody, null, 2) }
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
})

describe('verifySummary (#241)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-summary-'))
    mkdirSync(join(dir, '.evidence'), { recursive: true })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns pass stage when SUMMARY.json is valid and headSha matches', () => {
    const { serialised } = makeSummary()
    writeFileSync(join(dir, '.evidence', 'SUMMARY.json'), serialised)
    const result = verifySummary({ dir, headSha: HEAD_SHA })
    expect(result.ok).toBe(true)
    expect(result.stage).toBe('pass')
    expect(result.errors).toHaveLength(0)
  })

  it('returns missing stage when SUMMARY.json does not exist', () => {
    const result = verifySummary({ dir, headSha: HEAD_SHA })
    expect(result.ok).toBe(false)
    expect(result.stage).toBe('missing')
  })

  it('returns parse stage when SUMMARY.json is not valid JSON', () => {
    writeFileSync(join(dir, '.evidence', 'SUMMARY.json'), 'not json {')
    const result = verifySummary({ dir, headSha: HEAD_SHA })
    expect(result.ok).toBe(false)
    expect(result.stage).toBe('parse')
  })

  it('returns schema stage when required field is absent', () => {
    const { body } = makeSummary()
    const noGate = { ...body }
    delete noGate['obs_gate']
    writeFileSync(join(dir, '.evidence', 'SUMMARY.json'), JSON.stringify(noGate, null, 2))
    const result = verifySummary({ dir, headSha: HEAD_SHA })
    expect(result.ok).toBe(false)
    expect(result.stage).toBe('schema')
  })

  it('returns sha stage when embedded sha is tampered', () => {
    const { body } = makeSummary()
    const tampered = { ...body, security: { critical: 1, high: 0 } }
    writeFileSync(join(dir, '.evidence', 'SUMMARY.json'), JSON.stringify(tampered, null, 2))
    const result = verifySummary({ dir, headSha: HEAD_SHA })
    expect(result.ok).toBe(false)
    expect(result.stage).toBe('sha')
  })

  it('returns head stage when head_sha does not match injected headSha', () => {
    const { serialised } = makeSummary()
    writeFileSync(join(dir, '.evidence', 'SUMMARY.json'), serialised)
    const result = verifySummary({ dir, headSha: 'different000sha' })
    expect(result.ok).toBe(false)
    expect(result.stage).toBe('head')
    expect(result.errors.some((e) => e.includes('head_sha'))).toBe(true)
  })
})
