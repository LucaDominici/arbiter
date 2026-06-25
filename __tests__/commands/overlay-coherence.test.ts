// SPDX-License-Identifier: Apache-2.0
// #1254: overlay × governanceLevel coherence — extends the ADR-051 coherence
// machinery to the industryOverlay axis. Flags incoherent cells (e.g. a heavy
// compliance overlay at L1) as advisory WARNs. Never CRITICAL: an overlay never
// structurally breaks generation, so the strongest flag is WARN.
import { describe, it, expect } from 'vitest'
import type { GovernanceLevel } from '../../src/wizard/types.js'
import {
  validateOverlayCoherence,
  type IndustryOverlay,
} from '../../src/commands/wizard/coherence.js'

const ALL_LEVELS: GovernanceLevel[] = ['L1', 'L2', 'L3', 'L4']
const ALL_OVERLAYS: IndustryOverlay[] = [
  'none',
  'generic',
  'sox',
  'gdpr',
  'iso9001',
  'iso27001',
  'pharma',
  'regulated',
]

describe('validateOverlayCoherence — heavy compliance overlays (#1254)', () => {
  it('flags pharma @ L1 as WARN (heavy regulated overlay under lenient governance)', () => {
    const r = validateOverlayCoherence('pharma', 'L1')
    expect(r.valid).toBe(true)
    expect(r.severity).toBe('WARN')
    expect(r.message).toMatch(/pharma|L1|compliance/i)
  })

  it('flags iso27001 @ L1 as WARN', () => {
    const r = validateOverlayCoherence('iso27001', 'L1')
    expect(r.severity).toBe('WARN')
  })

  it('flags regulated @ L2 as WARN (heavy high-assurance overlay below L3)', () => {
    const r = validateOverlayCoherence('regulated', 'L2')
    expect(r.valid).toBe(true)
    expect(r.severity).toBe('WARN')
  })

  it('regulated @ L3 is OK (governance matches the high-assurance bundle)', () => {
    expect(validateOverlayCoherence('regulated', 'L3').severity).toBe('OK')
  })

  it('pharma @ L3 is OK (governance matches overlay weight)', () => {
    const r = validateOverlayCoherence('pharma', 'L3')
    expect(r.severity).toBe('OK')
    expect(r.valid).toBe(true)
  })

  it('pharma @ L4 is OK', () => {
    expect(validateOverlayCoherence('pharma', 'L4').severity).toBe('OK')
  })
})

describe('validateOverlayCoherence — medium compliance overlays', () => {
  it('flags gdpr @ L1 as WARN', () => {
    expect(validateOverlayCoherence('gdpr', 'L1').severity).toBe('WARN')
  })

  it('iso9001 @ L2 is OK', () => {
    expect(validateOverlayCoherence('iso9001', 'L2').severity).toBe('OK')
  })

  it('sox @ L2 is OK', () => {
    expect(validateOverlayCoherence('sox', 'L2').severity).toBe('OK')
  })
})

describe('validateOverlayCoherence — light / no overlay is always OK', () => {
  it('none overlay is OK at every level', () => {
    for (const level of ALL_LEVELS) {
      expect(validateOverlayCoherence('none', level).severity, `none@${level}`).toBe('OK')
    }
  })

  it('generic overlay is OK at every level', () => {
    for (const level of ALL_LEVELS) {
      expect(validateOverlayCoherence('generic', level).severity, `generic@${level}`).toBe('OK')
    }
  })
})

describe('validateOverlayCoherence — exhaustive matrix', () => {
  it('returns a result for every (overlay × level) cell, never CRITICAL', () => {
    for (const overlay of ALL_OVERLAYS) {
      for (const level of ALL_LEVELS) {
        const r = validateOverlayCoherence(overlay, level)
        expect(['OK', 'WARN'], `${overlay}@${level}`).toContain(r.severity)
        expect(r.valid, `${overlay}@${level}`).toBe(true)
      }
    }
  })

  it('WARN cells carry a non-empty advisory message; OK cells are empty', () => {
    const warn = validateOverlayCoherence('pharma', 'L1')
    expect(warn.message.length).toBeGreaterThan(0)
    const ok = validateOverlayCoherence('none', 'L2')
    expect(ok.message).toBe('')
  })
})
