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

describe('contextPack schema validation', () => {
  it('accepts config without contextPack field', () => {
    const result = validateConfig(validBase())
    expect(result.ok).toBe(true)
  })

  it('accepts contextPack with empty adrMappings array', () => {
    const result = validateConfig({ ...validBase(), contextPack: { adrMappings: [] } })
    expect(result.ok).toBe(true)
  })

  it('accepts contextPack with valid adrMappings', () => {
    const result = validateConfig({
      ...validBase(),
      contextPack: {
        adrMappings: [
          { pattern: 'src/api/**', adr: 'ADR-007' },
          { pattern: 'src/db/**', adr: 'ADR-012' },
        ],
      },
    })
    expect(result.ok).toBe(true)
  })

  it('rejects contextPack that is not an object', () => {
    const result = validateConfig({ ...validBase(), contextPack: 'invalid' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('contextPack'))).toBe(true)
    }
  })

  it('rejects adrMappings that is not an array', () => {
    const result = validateConfig({ ...validBase(), contextPack: { adrMappings: 'src/**' } })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('adrMappings'))).toBe(true)
    }
  })

  it('rejects adrMapping entry missing pattern', () => {
    const result = validateConfig({
      ...validBase(),
      contextPack: { adrMappings: [{ adr: 'ADR-007' }] },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('pattern'))).toBe(true)
    }
  })

  it('rejects adrMapping entry missing adr', () => {
    const result = validateConfig({
      ...validBase(),
      contextPack: { adrMappings: [{ pattern: 'src/**' }] },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('adr'))).toBe(true)
    }
  })

  it('round-trips contextPack.adrMappings through validation', () => {
    const adrMappings = [{ pattern: 'src/api/**', adr: 'ADR-007' }]
    const result = validateConfig({ ...validBase(), contextPack: { adrMappings } })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.contextPack?.adrMappings).toEqual(adrMappings)
    }
  })
})
