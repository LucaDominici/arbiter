// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { getExperiment, isEnabled } from '../../../src/experimental/registry.js'

describe('getExperiment (#601)', () => {
  it('throws on unknown experiment name', () => {
    expect(() => getExperiment('totally-unknown-exp-xyz')).toThrow()
  })

  it('returns a record for the registered "kit" experiment', () => {
    const result = getExperiment('kit')
    expect(result.name).toBe('kit')
    expect(['beta', 'stable']).toContain(result.stabilityTarget)
    expect(typeof result.addedIn).toBe('string')
    expect(typeof result.promotionCriteria).toBe('string')
    expect(typeof result.plannedReviewDate).toBe('string')
  })
})

describe('isEnabled (#601)', () => {
  it('returns false when flags map is empty', () => {
    expect(isEnabled('kit', {})).toBe(false)
  })

  it('returns true when experiment name is in flags', () => {
    expect(isEnabled('kit', { kit: true })).toBe(true)
  })

  it('throws on unknown experiment name', () => {
    expect(() => isEnabled('totally-unknown-exp-xyz', {})).toThrow()
  })
})
