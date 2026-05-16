// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { measure } from '../../src/utils/perf.js'

describe('measure (#544)', () => {
  it('returns correct sample count', () => {
    const result = measure(() => {}, 10)
    expect(result.samples).toBe(10)
  })

  it('p50 <= p95 <= p99', () => {
    const result = measure(() => {}, 50)
    expect(result.p50).toBeLessThanOrEqual(result.p95)
    expect(result.p95).toBeLessThanOrEqual(result.p99)
  })

  it('min <= p50 and max >= p99', () => {
    const result = measure(() => {}, 50)
    expect(result.min).toBeLessThanOrEqual(result.p50)
    expect(result.max).toBeGreaterThanOrEqual(result.p99)
  })

  it('timings are non-negative', () => {
    const result = measure(() => {}, 20)
    expect(result.min).toBeGreaterThanOrEqual(0)
    expect(result.p50).toBeGreaterThanOrEqual(0)
  })

  it('single iteration: all percentiles equal', () => {
    const result = measure(() => {}, 1)
    expect(result.samples).toBe(1)
    expect(result.p50).toBe(result.p95)
    expect(result.p95).toBe(result.p99)
  })

  it('throws when iterations is 0', () => {
    expect(() => measure(() => {}, 0)).toThrow(/iterations must be/)
  })

  it('throws when iterations is negative', () => {
    expect(() => measure(() => {}, -1)).toThrow(/iterations must be/)
  })
})
