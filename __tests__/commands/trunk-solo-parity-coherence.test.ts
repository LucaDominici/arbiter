// SPDX-License-Identifier: Apache-2.0
//
// #1977: trunk-solo requires local-ci-parity check + push-gating wired.
// A no-PR flow is only sound when `run.sh gate full ≡ CI` — without a PR
// there is no independent CI net before trunk. A trunk-solo config missing
// either the parity check or push-gating is CRITICAL, not a warning.
import { describe, it, expect } from 'vitest'
import { validateTrunkSoloParityCoherence } from '../../src/commands/wizard/coherence.js'

describe('validateTrunkSoloParityCoherence — trunk-solo requires parity + push-gating', () => {
  it('CRITICAL: trunk-solo with neither parity check nor push-gating', () => {
    const r = validateTrunkSoloParityCoherence('trunk-solo', {
      hasParityCheck: false,
      hasPushGating: false,
    })
    expect(r.valid).toBe(false)
    expect(r.severity).toBe('CRITICAL')
    expect(r.message).toContain('local-ci-parity')
    expect(r.remediation).toBeTruthy()
  })

  it('CRITICAL: trunk-solo with push-gating but no parity check', () => {
    const r = validateTrunkSoloParityCoherence('trunk-solo', {
      hasParityCheck: false,
      hasPushGating: true,
    })
    expect(r.valid).toBe(false)
    expect(r.severity).toBe('CRITICAL')
  })

  it('CRITICAL: trunk-solo with parity check but no push-gating', () => {
    const r = validateTrunkSoloParityCoherence('trunk-solo', {
      hasParityCheck: true,
      hasPushGating: false,
    })
    expect(r.valid).toBe(false)
    expect(r.severity).toBe('CRITICAL')
    expect(r.message).toContain('push')
  })

  it('OK: trunk-solo with both parity check and push-gating wired', () => {
    const r = validateTrunkSoloParityCoherence('trunk-solo', {
      hasParityCheck: true,
      hasPushGating: true,
    })
    expect(r.valid).toBe(true)
    expect(r.severity).toBe('OK')
  })

  it('OK: peer-review never requires parity/push-gating (PR is the net)', () => {
    const r = validateTrunkSoloParityCoherence('peer-review', {
      hasParityCheck: false,
      hasPushGating: false,
    })
    expect(r.valid).toBe(true)
    expect(r.severity).toBe('OK')
  })

  it('OK: gated-review never requires parity/push-gating (PR is the net)', () => {
    const r = validateTrunkSoloParityCoherence('gated-review', {
      hasParityCheck: false,
      hasPushGating: false,
    })
    expect(r.valid).toBe(true)
    expect(r.severity).toBe('OK')
  })
})
