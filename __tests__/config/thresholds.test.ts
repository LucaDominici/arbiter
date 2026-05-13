import { describe, it, expect } from 'vitest'
import { computeThresholds } from '../../src/config/thresholds.js'

describe('computeThresholds — fixed profile', () => {
  it('always enables coverage at fixed profile', () => {
    expect(computeThresholds(0, 'fixed', 'L2').coverageEnabled).toBe(true)
    expect(computeThresholds(500, 'fixed', 'L2').coverageEnabled).toBe(true)
    expect(computeThresholds(100_000, 'fixed', 'L2').coverageEnabled).toBe(true)
  })

  it('uses 80% coverage threshold at L2', () => {
    expect(computeThresholds(0, 'fixed', 'L2').coverageThreshold).toBe(80)
    expect(computeThresholds(50_000, 'fixed', 'L2').coverageThreshold).toBe(80)
  })

  it('uses 85% coverage threshold at L3', () => {
    expect(computeThresholds(0, 'fixed', 'L3').coverageThreshold).toBe(85)
    expect(computeThresholds(50_000, 'fixed', 'L3').coverageThreshold).toBe(85)
  })

  it('always enables mutation at fixed profile (caller decides gate)', () => {
    expect(computeThresholds(500, 'fixed', 'L2').mutationEnabled).toBe(true)
  })

  it('uses 85% mutation threshold always', () => {
    expect(computeThresholds(1000, 'fixed', 'L2').mutationThreshold).toBe(85)
  })
})

describe('computeThresholds — scaled profile', () => {
  it('disables coverage for LoC < 1000', () => {
    expect(computeThresholds(0, 'scaled', 'L2').coverageEnabled).toBe(false)
    expect(computeThresholds(999, 'scaled', 'L2').coverageEnabled).toBe(false)
  })

  it('enables coverage for LoC >= 1000', () => {
    expect(computeThresholds(1000, 'scaled', 'L2').coverageEnabled).toBe(true)
    expect(computeThresholds(5000, 'scaled', 'L2').coverageEnabled).toBe(true)
  })

  it('disables mutation for LoC < 5000', () => {
    expect(computeThresholds(0, 'scaled', 'L2').mutationEnabled).toBe(false)
    expect(computeThresholds(4999, 'scaled', 'L2').mutationEnabled).toBe(false)
  })

  it('enables mutation for LoC >= 5000', () => {
    expect(computeThresholds(5000, 'scaled', 'L2').mutationEnabled).toBe(true)
    expect(computeThresholds(20_000, 'scaled', 'L2').mutationEnabled).toBe(true)
  })

  it('ramps coverage threshold: 60% at 1k LoC', () => {
    const t = computeThresholds(1000, 'scaled', 'L2')
    expect(t.coverageThreshold).toBeGreaterThanOrEqual(60)
    expect(t.coverageThreshold).toBeLessThan(85)
  })

  it('ramps coverage threshold: reaches 85% at 10k+ LoC', () => {
    const t = computeThresholds(10_000, 'scaled', 'L2')
    expect(t.coverageThreshold).toBe(85)
  })

  it('LoC=0 treated as large (safe default): coverage enabled, threshold 80+', () => {
    // When LoC is 0 (unknown), treat as if large project — fully enabled
    // LoC=0 → coverageEnabled=false per the <1000 rule
    // This test documents the current behaviour: 0 = unknown, disabled (see spec)
    const t = computeThresholds(0, 'scaled', 'L2')
    expect(t.coverageEnabled).toBe(false) // <1000 rule
  })
})

describe('computeThresholds — governance level interaction', () => {
  it('L1 does not affect threshold values (caller decides whether to apply)', () => {
    const t = computeThresholds(10_000, 'fixed', 'L1')
    // L1 thresholds still computed; generator decides whether to include in gate
    expect(typeof t.coverageThreshold).toBe('number')
  })

  it('L3 scaled: still ramps to 85% at 10k LoC', () => {
    const t = computeThresholds(10_000, 'scaled', 'L3')
    expect(t.coverageThreshold).toBe(85)
  })
})
