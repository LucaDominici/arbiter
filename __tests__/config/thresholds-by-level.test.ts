import { describe, it, expect } from 'vitest'
import { getCiThresholds } from '../../src/config/thresholds-by-level.js'

describe('getCiThresholds — L1', () => {
  const t = getCiThresholds('L1')

  it('coverage line 70%, branch 60%', () => {
    expect(t.coverageLine).toBe(70)
    expect(t.coverageBranch).toBe(60)
  })

  it('mutation informational (threshold 0)', () => {
    expect(t.mutation.gating).toBe('informational')
    expect(t.mutation.threshold).toBe(0)
  })

  it('CVSS gate ≥9.0', () => {
    expect(t.cvssGateMin).toBe(9.0)
  })

  it('container scan warns only', () => {
    expect(t.containerScan).toBe('warn')
  })

  it('SAST warns only', () => {
    expect(t.sast).toBe('warn')
  })

  it('SLSA target L1', () => {
    expect(t.slsaTarget).toBe('L1')
  })

  it('tag-ok action pinning', () => {
    expect(t.actionPinning).toBe('tag-ok')
  })

  it('no CODEOWNER required', () => {
    expect(t.codeownerRequired).toBe(false)
  })
})

describe('getCiThresholds — L2', () => {
  const t = getCiThresholds('L2')

  it('coverage line 80%, branch 70%', () => {
    expect(t.coverageLine).toBe(80)
    expect(t.coverageBranch).toBe(70)
  })

  it('mutation blocking at 75%', () => {
    expect(t.mutation.gating).toBe('blocking')
    expect(t.mutation.threshold).toBe(75)
  })

  it('CVSS gate ≥7.0', () => {
    expect(t.cvssGateMin).toBe(7.0)
  })

  it('container scan high-critical', () => {
    expect(t.containerScan).toBe('high-critical')
  })

  it('SAST high-plus', () => {
    expect(t.sast).toBe('high-plus')
  })

  it('SLSA target L2', () => {
    expect(t.slsaTarget).toBe('L2')
  })

  it('SHA-required action pinning', () => {
    expect(t.actionPinning).toBe('sha-required')
  })

  it('cross-stack-guard is hard-fail', () => {
    expect(t.crossStackGuardHard).toBe(true)
  })
})

describe('getCiThresholds — L3', () => {
  const t = getCiThresholds('L3')

  it('coverage line 85%, branch 80%', () => {
    expect(t.coverageLine).toBe(85)
    expect(t.coverageBranch).toBe(80)
  })

  it('mutation blocking at 80%', () => {
    expect(t.mutation.gating).toBe('blocking')
    expect(t.mutation.threshold).toBe(80)
  })

  it('CVSS gate ≥4.0', () => {
    expect(t.cvssGateMin).toBe(4.0)
  })

  it('container scan medium-plus', () => {
    expect(t.containerScan).toBe('medium-plus')
  })

  it('SAST medium-plus', () => {
    expect(t.sast).toBe('medium-plus')
  })

  it('SLSA target L3', () => {
    expect(t.slsaTarget).toBe('L3')
  })

  it('sha-renovate-gated action pinning', () => {
    expect(t.actionPinning).toBe('sha-renovate-gated')
  })

  it('debt-ratchet requires improvement', () => {
    expect(t.debtRatchetRequireImprovement).toBe(true)
  })

  it('CODEOWNER required', () => {
    expect(t.codeownerRequired).toBe(true)
  })
})

describe('getCiThresholds — L4', () => {
  const t = getCiThresholds('L4')

  it('coverage line 85%, branch 80%', () => {
    expect(t.coverageLine).toBe(85)
    expect(t.coverageBranch).toBe(80)
  })

  it('mutation blocking at 80%', () => {
    expect(t.mutation.gating).toBe('blocking')
    expect(t.mutation.threshold).toBe(80)
  })

  it('CVSS gate ≥4.0', () => {
    expect(t.cvssGateMin).toBe(4.0)
  })

  it('SLSA target L3 (compliance-grade attestation)', () => {
    expect(t.slsaTarget).toBe('L3')
  })

  it('sha-renovate-gated action pinning', () => {
    expect(t.actionPinning).toBe('sha-renovate-gated')
  })

  it('CODEOWNER required', () => {
    expect(t.codeownerRequired).toBe(true)
  })
})

describe('getCiThresholds — monotonicity', () => {
  it('coverage tightens L1 → L2 → L3 (L4 equals L3)', () => {
    const l1 = getCiThresholds('L1')
    const l2 = getCiThresholds('L2')
    const l3 = getCiThresholds('L3')
    const l4 = getCiThresholds('L4')
    expect(l1.coverageLine).toBeLessThan(l2.coverageLine)
    expect(l2.coverageLine).toBeLessThan(l3.coverageLine)
    expect(l3.coverageLine).toBe(l4.coverageLine)
    expect(l1.coverageBranch).toBeLessThan(l2.coverageBranch)
    expect(l2.coverageBranch).toBeLessThan(l3.coverageBranch)
    expect(l3.coverageBranch).toBe(l4.coverageBranch)
  })

  it('CVSS gate tightens L1 → L2 → L3 (L4 equals L3)', () => {
    const l1 = getCiThresholds('L1')
    const l2 = getCiThresholds('L2')
    const l3 = getCiThresholds('L3')
    const l4 = getCiThresholds('L4')
    expect(l1.cvssGateMin).toBeGreaterThan(l2.cvssGateMin)
    expect(l2.cvssGateMin).toBeGreaterThan(l3.cvssGateMin)
    expect(l3.cvssGateMin).toBe(l4.cvssGateMin)
  })

  it('L4 SLSA target is L3 (one step above L3 project SLSA)', () => {
    expect(getCiThresholds('L3').slsaTarget).toBe('L3')
    expect(getCiThresholds('L4').slsaTarget).toBe('L3')
  })
})
