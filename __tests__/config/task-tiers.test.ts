import { describe, it, expect } from 'vitest'
import { validateConfig } from '../../src/config/schema.js'

const BASE = {
  version: '0.2',
  tools: ['claude'],
  governanceLevel: 'L2',
  useGitHub: false,
  features: {
    contractTesting: false,
    mutationTesting: true,
    securityScanning: true,
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

describe('taskTiers schema (#237)', () => {
  it('accepts config with no taskTiers (optional)', () => {
    const result = validateConfig(BASE)
    expect(result.ok).toBe(true)
  })

  it('accepts valid taskTiers', () => {
    const result = validateConfig({
      ...BASE,
      taskTiers: {
        XS: { planDepth: 'minimal', reviewAgentCount: 3 },
        S: { planDepth: 'brief', reviewAgentCount: 3 },
        Standard: { planDepth: 'full', reviewAgentCount: 4 },
      },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.taskTiers?.XS.planDepth).toBe('minimal')
      expect(result.config.taskTiers?.Standard.reviewAgentCount).toBe(4)
    }
  })

  it('rejects taskTiers missing a required tier', () => {
    const result = validateConfig({
      ...BASE,
      taskTiers: {
        XS: { planDepth: 'minimal', reviewAgentCount: 3 },
        S: { planDepth: 'brief', reviewAgentCount: 3 },
        // Standard missing
      },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join(' ')).toMatch(/Standard/)
    }
  })

  it('rejects invalid planDepth value', () => {
    const result = validateConfig({
      ...BASE,
      taskTiers: {
        XS: { planDepth: 'lol', reviewAgentCount: 3 },
        S: { planDepth: 'brief', reviewAgentCount: 3 },
        Standard: { planDepth: 'full', reviewAgentCount: 4 },
      },
    })
    expect(result.ok).toBe(false)
  })

  it('rejects non-positive reviewAgentCount', () => {
    const result = validateConfig({
      ...BASE,
      taskTiers: {
        XS: { planDepth: 'minimal', reviewAgentCount: 0 },
        S: { planDepth: 'brief', reviewAgentCount: 3 },
        Standard: { planDepth: 'full', reviewAgentCount: 4 },
      },
    })
    expect(result.ok).toBe(false)
  })
})
