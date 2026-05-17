// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import {
  getExperiment,
  listExperiments,
  isEnabled,
  type ExperimentRecord,
} from '../../../src/experimental/registry.js'

describe('listExperiments (#601)', () => {
  it('returns an array', () => {
    expect(Array.isArray(listExperiments())).toBe(true)
  })

  it('each entry has required fields', () => {
    const experiments = listExperiments()
    for (const exp of experiments) {
      expect(typeof exp.name).toBe('string')
      expect(['beta', 'stable']).toContain(exp.stabilityTarget)
      expect(typeof exp.addedIn).toBe('string')
      expect(typeof exp.promotionCriteria).toBe('string')
      expect(typeof exp.plannedReviewDate).toBe('string')
    }
  })
})

describe('getExperiment (#601)', () => {
  it('throws on unknown experiment name', () => {
    expect(() => getExperiment('totally-unknown-exp-xyz')).toThrow()
  })

  it('returns a record for a registered experiment', () => {
    const experiments = listExperiments()
    if (experiments.length === 0) return // vacuously passes when no experiments registered
    const first = experiments[0] as ExperimentRecord
    const result = getExperiment(first.name)
    expect(result.name).toBe(first.name)
    expect(result.stabilityTarget).toBe(first.stabilityTarget)
  })
})

describe('isEnabled (#601)', () => {
  it('returns false when flags map is empty', () => {
    const experiments = listExperiments()
    if (experiments.length === 0) return
    const first = experiments[0] as ExperimentRecord
    expect(isEnabled(first.name, {})).toBe(false)
  })

  it('returns true when experiment name is in flags', () => {
    const experiments = listExperiments()
    if (experiments.length === 0) return
    const first = experiments[0] as ExperimentRecord
    expect(isEnabled(first.name, { [first.name]: true })).toBe(true)
  })

  it('throws on unknown experiment name', () => {
    expect(() => isEnabled('totally-unknown-exp-xyz', {})).toThrow()
  })
})
