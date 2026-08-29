// SPDX-License-Identifier: Apache-2.0
// #2401 — the train is the default unit of ceremony, so its bounds must be a
// per-project decision instead of a constant compiled into ship-train.ts.
// RED: `validateConfig` has no `ship` field today and `resolveTrainLimits` does
// not exist, so a config declaring `ship.train` is silently dropped.
import { describe, it, expect } from 'vitest'
import { validateConfig } from '../../src/config/schema.js'
import { DEFAULT_TRAIN_LIMITS, resolveTrainLimits } from '../../src/commands/ship-train.js'

function validBase() {
  return {
    version: '0.2',
    governanceLevel: 'L2',
    tools: ['claude'],
    useGitHub: false,
    features: {
      contractTesting: false,
      mutationTesting: false,
      securityScanning: false,
      evidenceHarness: false,
      debtGates: true,
      suppressions: true,
    },
    thresholds: {
      lineCoverage: 80,
      branchCoverage: 70,
      mutationScore: 80,
      cyclomaticComplexity: 15,
      methodLength: 65,
      maxParams: 7,
    },
  }
}

describe('ship config surface (#2401)', () => {
  it('AC-2401.1: accepts a ship.train declaration', () => {
    const result = validateConfig({
      ...validBase(),
      ship: { train: { maxChain: 4, maxAgeMinutes: 120 } },
    })
    expect(result.ok).toBe(true)
  })

  it('AC-2401.4: accepts a ship.review.maxRounds declaration', () => {
    const result = validateConfig({ ...validBase(), ship: { review: { maxRounds: 3 } } })
    expect(result.ok).toBe(true)
  })

  it('rejects a non-object ship block', () => {
    const result = validateConfig({ ...validBase(), ship: 'yes' })
    expect(result.ok).toBe(false)
  })

  it('rejects a train bound that is not a positive integer', () => {
    expect(validateConfig({ ...validBase(), ship: { train: { maxChain: 0 } } }).ok).toBe(false)
    expect(validateConfig({ ...validBase(), ship: { train: { maxAgeMinutes: 1.5 } } }).ok).toBe(
      false,
    )
  })

  it('rejects a review round cap below 1 — a cap of 0 forbids review itself', () => {
    expect(validateConfig({ ...validBase(), ship: { review: { maxRounds: 0 } } }).ok).toBe(false)
  })

  it('leaves the ship block optional — absent config still validates', () => {
    expect(validateConfig(validBase()).ok).toBe(true)
  })
})

describe('resolveTrainLimits (#2401)', () => {
  it('AC-2401.1: defaults to a ten-issue, eight-hour train', () => {
    expect(DEFAULT_TRAIN_LIMITS).toEqual({ maxChain: 10, maxAgeMinutes: 480 })
    expect(resolveTrainLimits(undefined)).toEqual(DEFAULT_TRAIN_LIMITS)
  })

  it('AC-2401.1: takes each declared bound from config', () => {
    expect(resolveTrainLimits({ train: { maxChain: 3, maxAgeMinutes: 60 } })).toEqual({
      maxChain: 3,
      maxAgeMinutes: 60,
    })
  })

  it('AC-2401.1: falls back per-field, so a half-declared block keeps the other default', () => {
    expect(resolveTrainLimits({ train: { maxChain: 3 } })).toEqual({
      maxChain: 3,
      maxAgeMinutes: DEFAULT_TRAIN_LIMITS.maxAgeMinutes,
    })
    expect(resolveTrainLimits({ review: { maxRounds: 1 } })).toEqual(DEFAULT_TRAIN_LIMITS)
  })
})
