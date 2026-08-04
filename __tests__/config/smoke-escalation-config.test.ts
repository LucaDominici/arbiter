// SPDX-License-Identifier: Apache-2.0
// #2043 — AC-2043.2 RED: the per-project smoke-journey floor and the e2e escalation
// policy must be DECLARABLE in arbiter.json (schema surface), not hardcoded.
// RED: today validateConfig has no smokeJourneys / e2ePolicy fields — a config
// carrying them is either rejected (unknown-field strictness) or silently dropped.
import { describe, it, expect } from 'vitest'
import { validateConfig } from '../../src/config/schema.js'

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

describe('smokeJourneys + e2ePolicy config surface (#2043)', () => {
  it('AC-2043.2: accepts a smokeJourneys.requiredJourneys + minJourneys declaration', () => {
    const result = validateConfig({
      ...validBase(),
      smokeJourneys: { requiredJourneys: ['auth', 'crud', 'authz'], minJourneys: 3 },
    })
    expect(result.ok).toBe(true)
  })

  it('AC-2043.2: accepts an e2ePolicy.escalation strikes + maxStrikes declaration', () => {
    const result = validateConfig({
      ...validBase(),
      e2ePolicy: { escalation: { strikes: [2, 3, 5], maxStrikes: 5 } },
    })
    expect(result.ok).toBe(true)
  })

  it('AC-2043.2: rejects minJourneys outside the 2..4 per-project floor', () => {
    const tooFew = validateConfig({ ...validBase(), smokeJourneys: { minJourneys: 1 } })
    expect(tooFew.ok).toBe(false)
    const tooMany = validateConfig({ ...validBase(), smokeJourneys: { minJourneys: 7 } })
    expect(tooMany.ok).toBe(false)
  })

  it('AC-2043.2: rejects a maxStrikes below 2 (an escalation that fires on the first failure)', () => {
    const result = validateConfig({
      ...validBase(),
      e2ePolicy: { escalation: { strikes: [1], maxStrikes: 1 } },
    })
    expect(result.ok).toBe(false)
  })
})
