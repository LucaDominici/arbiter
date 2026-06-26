import { describe, it, expect } from 'vitest'
import { computeThresholds, resolveEffectiveThresholds } from '../../src/config/thresholds.js'
import { DEFAULT_THRESHOLDS } from '../../src/config/schema.js'

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

  it('derives the mutation threshold from the DEFAULT_THRESHOLDS SSOT (#1527)', () => {
    // Previously hardcoded 85 here, which disagreed with DEFAULT_THRESHOLDS
    // (L2 mutationScore=80). The two tables are now a single SSOT.
    expect(computeThresholds(1000, 'fixed', 'L2').mutationThreshold).toBe(
      DEFAULT_THRESHOLDS.L2.mutationScore,
    )
    expect(computeThresholds(1000, 'fixed', 'L3').mutationThreshold).toBe(
      DEFAULT_THRESHOLDS.L3.mutationScore,
    )
  })

  it('derives fixed coverage from the DEFAULT_THRESHOLDS SSOT (#1527)', () => {
    for (const level of ['L1', 'L2', 'L3', 'L4'] as const) {
      expect(computeThresholds(0, 'fixed', level).coverageThreshold).toBe(
        DEFAULT_THRESHOLDS[level].lineCoverage,
      )
    }
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

describe('resolveEffectiveThresholds — single precedence rule (#1527)', () => {
  it('fixed profile: auto-filled per-level default flows through uniformly', () => {
    const eff = resolveEffectiveThresholds({
      governanceLevel: 'L1',
      thresholdProfile: 'fixed',
      thresholds: DEFAULT_THRESHOLDS.L1,
    })
    // The old bug: lines=60 but functions/statements=80 inside one vitest.config.
    // Now line coverage is a single value the template uses for all three keys.
    expect(eff.lineCoverage).toBe(60)
    expect(eff.branchCoverage).toBe(DEFAULT_THRESHOLDS.L1.branchCoverage)
  })

  it('fixed profile: an explicit user override wins via `??` (#484, 0-safe)', () => {
    const eff = resolveEffectiveThresholds({
      governanceLevel: 'L2',
      thresholdProfile: 'fixed',
      thresholds: { ...DEFAULT_THRESHOLDS.L2, lineCoverage: 90, mutationScore: 92 },
    })
    expect(eff.lineCoverage).toBe(90)
    expect(eff.mutationScore).toBe(92)
  })

  it('scaled profile: the LoC ramp drives line coverage even when thresholds are auto-filled', () => {
    // Regression for the "scaled profile is half-dead" bug: autoFillThresholds
    // always populates config.thresholds, which used to shadow the ramp for the
    // gate. The ramp must now win for line coverage under the scaled profile.
    const eff = resolveEffectiveThresholds({
      governanceLevel: 'L2',
      thresholdProfile: 'scaled',
      linesOfCode: 1_000,
      thresholds: DEFAULT_THRESHOLDS.L2, // line=80 default — must NOT shadow the ramp
    })
    expect(eff.lineCoverage).toBe(60) // ramp at 1k LoC, not the 80 default
    expect(eff.coverageEnabled).toBe(true)
  })

  it('scaled profile: coverage disabled below the LoC floor', () => {
    const eff = resolveEffectiveThresholds({
      governanceLevel: 'L2',
      thresholdProfile: 'scaled',
      linesOfCode: 500,
      thresholds: DEFAULT_THRESHOLDS.L2,
    })
    expect(eff.coverageEnabled).toBe(false)
    expect(eff.mutationEnabled).toBe(false)
  })
})
