import { describe, it, expect } from 'vitest'
import {
  checkMaturity,
  isL3Allowed,
  type MaturityLevel,
  type MaturityResult,
} from '../../src/utils/maturity-check.js'

describe('checkMaturity', () => {
  it('returns proven for java mutation testing', () => {
    const result = checkMaturity('java', 'mutation')
    expect(result.maturity).toBe<MaturityLevel>('proven')
  })

  it('returns proven for typescript mutation testing', () => {
    const result = checkMaturity('typescript', 'mutation')
    expect(result.maturity).toBe<MaturityLevel>('proven')
  })

  it('returns unsafe for go mutation testing', () => {
    const result = checkMaturity('go', 'mutation')
    expect(result.maturity).toBe<MaturityLevel>('unsafe')
  })

  it('returns beta for rust mutation testing', () => {
    const result = checkMaturity('rust', 'mutation')
    expect(result.maturity).toBe<MaturityLevel>('beta')
  })

  it('returns beta for python mutation testing', () => {
    const result = checkMaturity('python', 'mutation')
    expect(result.maturity).toBe<MaturityLevel>('beta')
  })

  it('returns proven for java contract testing', () => {
    const result = checkMaturity('java', 'contract')
    expect(result.maturity).toBe<MaturityLevel>('proven')
  })

  it('returns proven for typescript contract testing', () => {
    const result = checkMaturity('typescript', 'contract')
    expect(result.maturity).toBe<MaturityLevel>('proven')
  })

  it('returns beta for python contract testing', () => {
    const result = checkMaturity('python', 'contract')
    expect(result.maturity).toBe<MaturityLevel>('beta')
  })

  it('includes a human-readable reason for unsafe cells', () => {
    const result = checkMaturity('go', 'mutation')
    expect(result.reason).toMatch(/go-mutesting/i)
  })

  it('includes a human-readable reason for beta cells', () => {
    const result = checkMaturity('rust', 'mutation')
    expect(result.reason).toMatch(/cargo-mutants/i)
  })

  it('returns unavailable for unknown feature', () => {
    const result = checkMaturity('go', 'e2e')
    expect(result.maturity).toBe<MaturityLevel>('unavailable')
  })

  it('returns proven for go coverage', () => {
    const result = checkMaturity('go', 'coverage')
    expect(result.maturity).toBe<MaturityLevel>('proven')
  })

  it('returns proven for rust coverage', () => {
    const result = checkMaturity('rust', 'coverage')
    expect(result.maturity).toBe<MaturityLevel>('proven')
  })
})

describe('isL3Allowed', () => {
  it('allows proven feature at L3 without flag', () => {
    expect(isL3Allowed('java', 'mutation', false)).toEqual({ allowed: true })
  })

  it('allows typescript mutation at L3 without flag', () => {
    expect(isL3Allowed('typescript', 'mutation', false)).toEqual({
      allowed: true,
    })
  })

  it('blocks unsafe feature at L3 without flag', () => {
    const result = isL3Allowed('go', 'mutation', false)
    expect(result.allowed).toBe(false)
    expect(result.errorMessage).toMatch(/unsafe/i)
    expect(result.errorMessage).toMatch(/go-mutesting/i)
  })

  it('blocks unsafe feature at L3 even with accept-beta-tools flag', () => {
    // unsafe is never allowed — only beta can be unlocked with the flag
    const result = isL3Allowed('go', 'mutation', true)
    expect(result.allowed).toBe(false)
    expect(result.errorMessage).toMatch(/unsafe/i)
  })

  // #1628: the python a11y harness (axe-playwright-python = beta) must be gated at L3.
  it('blocks python a11y (beta) at L3 without flag', () => {
    const result = isL3Allowed('python', 'a11y', false)
    expect(result.allowed).toBe(false)
    expect(result.errorMessage).toMatch(/beta/i)
    expect(result.errorMessage).toMatch(/--accept-beta-tools/i)
  })

  it('allows python a11y at L3 with --accept-beta-tools', () => {
    expect(isL3Allowed('python', 'a11y', true)).toEqual({ allowed: true })
  })

  it('allows typescript a11y (proven) at L3 without flag', () => {
    expect(isL3Allowed('typescript', 'a11y', false)).toEqual({ allowed: true })
  })

  it('blocks beta feature at L3 without flag', () => {
    const result = isL3Allowed('rust', 'mutation', false)
    expect(result.allowed).toBe(false)
    expect(result.errorMessage).toMatch(/beta/i)
    expect(result.errorMessage).toMatch(/--accept-beta-tools/i)
  })

  it('allows beta feature at L3 with accept-beta-tools flag', () => {
    const result = isL3Allowed('rust', 'mutation', true)
    expect(result.allowed).toBe(true)
  })

  it('blocks unavailable feature at L3', () => {
    const result = isL3Allowed('go', 'e2e', false)
    expect(result.allowed).toBe(false)
    expect(result.errorMessage).toMatch(/unavailable/i)
  })

  it('blocks unavailable feature even with flag', () => {
    const result = isL3Allowed('go', 'e2e', true)
    expect(result.allowed).toBe(false)
  })

  it('allows python beta mutation with flag', () => {
    expect(isL3Allowed('python', 'mutation', true)).toEqual({ allowed: true })
  })
})

// #1595: the matrix JSON is cast `as MaturityMatrix` with no runtime validation, so a
// hand-edited typo or a future tier can flow through checkMaturity as an out-of-union
// maturity. The isL3Allowed switch had no `default` arm — it fell off the end returning
// `undefined`, crashing every caller with an opaque `reading 'allowed'` TypeError. The
// `resolve` seam injects such a value to pin the fail-safe (block + name the value).
describe('isL3Allowed — out-of-union maturity fail-safe (#1595)', () => {
  const badResolve = (): MaturityResult => ({
    maturity: 'experimental' as MaturityLevel,
    tool: 'some-tool',
    reason: 'hand-edited matrix typo',
  })

  it('returns a blocked result naming the unexpected maturity (never crashes/undefined)', () => {
    const result = isL3Allowed('typescript', 'mutation', false, badResolve)
    expect(result).toBeDefined()
    expect(result.allowed).toBe(false)
    expect(result.errorMessage).toContain('experimental')
  })

  it('blocks even with accept-beta-tools for an unexpected maturity', () => {
    const result = isL3Allowed('typescript', 'mutation', true, badResolve)
    expect(result.allowed).toBe(false)
  })

  it('still honours a valid maturity supplied through the injected resolver', () => {
    const result = isL3Allowed('typescript', 'mutation', false, () => ({
      maturity: 'proven',
      tool: 't',
      reason: 'r',
    }))
    expect(result).toEqual({ allowed: true })
  })
})
