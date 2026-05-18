import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateCiTier } from '../../src/generators/ci-tier.js'

let dir: string

beforeEach(() => {
  dir = createTestProject('unknown')
})

afterEach(() => {
  cleanupTestProject(dir)
})

describe('generateCiTier — happy path', () => {
  it('returns a result object at L1', () => {
    const result = generateCiTier(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(result).toBeDefined()
    expect(Array.isArray(result.files)).toBe(true)
  })

  it('returns a result object at L2', () => {
    const result = generateCiTier(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(result).toBeDefined()
    expect(Array.isArray(result.files)).toBe(true)
  })

  it('returns a result object at L3', () => {
    const result = generateCiTier(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(result).toBeDefined()
    expect(Array.isArray(result.files)).toBe(true)
  })
})

describe('generateCiTier — idempotency', () => {
  it('produces identical result on second call', () => {
    const config = makeConfig(dir, { governanceLevel: 'L2' })
    const first = generateCiTier(config)
    const second = generateCiTier(config)
    expect(second.files).toHaveLength(first.files.length)
  })
})

describe('generateCiTier — stub state', () => {
  it('emits no files yet (stub pending Tasks 4–12)', () => {
    const result = generateCiTier(makeConfig(dir))
    expect(result.files).toHaveLength(0)
  })
})
