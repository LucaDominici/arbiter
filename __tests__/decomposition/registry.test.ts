import { describe, it, expect } from 'vitest'
import { getBackend } from '../../src/decomposition/registry.js'
import type { ArbiterConfigV2 } from '../../src/config/schema.js'

function baseConfig(overrides: Partial<ArbiterConfigV2> = {}): ArbiterConfigV2 {
  return {
    version: '0.2',
    tools: ['claude'],
    governanceLevel: 'L2',
    useGitHub: false,
    features: {
      contractTesting: false,
      mutationTesting: false,
      securityScanning: false,
      evidenceHarness: false,
      debtGates: false,
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
    ...overrides,
  }
}

describe('getBackend', () => {
  it("returns markdown backend when decomposition.backend is 'markdown'", () => {
    const config = baseConfig({
      decomposition: { backend: 'markdown' },
    })
    const b = getBackend(config)
    expect(b.id).toBe('markdown')
  })

  it("returns github backend when decomposition.backend is 'github'", () => {
    const config = baseConfig({
      useGitHub: true,
      decomposition: { backend: 'github' },
    })
    const b = getBackend(config)
    expect(b.id).toBe('github')
  })

  it('defaults to github when decomposition is absent and useGitHub is true', () => {
    const config = baseConfig({ useGitHub: true })
    const b = getBackend(config)
    expect(b.id).toBe('github')
  })

  it('defaults to markdown when decomposition is absent and useGitHub is false', () => {
    const config = baseConfig({ useGitHub: false })
    const b = getBackend(config)
    expect(b.id).toBe('markdown')
  })

  it('throws on unknown backend id', () => {
    const config = baseConfig({
      decomposition: { backend: 'unknown' as 'markdown' },
    })
    expect(() => getBackend(config)).toThrow(/unknown decomposition backend/i)
  })
})
