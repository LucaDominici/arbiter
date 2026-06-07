// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests — solo reactivation trigger logic (#1250)
 * Tests the author-counting and external-audit-flag logic in isolation.
 */
import { describe, it, expect } from 'vitest'
import { shouldReactivate, type ReactivationInput } from '../../src/generators/solo-exception.js'

// ─── Core reactivation logic ─────────────────────────────────────────────────

describe('shouldReactivate — author count threshold', () => {
  it('fires at exactly 3 distinct authors (threshold)', () => {
    const input: ReactivationInput = {
      distinctAuthorCount: 3,
      externalAudit: false,
    }
    expect(shouldReactivate(input)).toBe(true)
  })

  it('fires at 4 distinct authors (above threshold)', () => {
    const input: ReactivationInput = {
      distinctAuthorCount: 4,
      externalAudit: false,
    }
    expect(shouldReactivate(input)).toBe(true)
  })

  it('silent at 2 distinct authors (below threshold)', () => {
    const input: ReactivationInput = {
      distinctAuthorCount: 2,
      externalAudit: false,
    }
    expect(shouldReactivate(input)).toBe(false)
  })

  it('silent at 1 author (solo mode)', () => {
    const input: ReactivationInput = {
      distinctAuthorCount: 1,
      externalAudit: false,
    }
    expect(shouldReactivate(input)).toBe(false)
  })

  it('silent at 0 authors (new repo, empty git log)', () => {
    const input: ReactivationInput = {
      distinctAuthorCount: 0,
      externalAudit: false,
    }
    expect(shouldReactivate(input)).toBe(false)
  })
})

describe('shouldReactivate — external audit flag', () => {
  it('fires when externalAudit=true regardless of author count', () => {
    const input: ReactivationInput = {
      distinctAuthorCount: 1,
      externalAudit: true,
    }
    expect(shouldReactivate(input)).toBe(true)
  })

  it('fires when externalAudit=true and author count=0', () => {
    const input: ReactivationInput = {
      distinctAuthorCount: 0,
      externalAudit: true,
    }
    expect(shouldReactivate(input)).toBe(true)
  })

  it('does not fire when externalAudit=false and count=2', () => {
    const input: ReactivationInput = {
      distinctAuthorCount: 2,
      externalAudit: false,
    }
    expect(shouldReactivate(input)).toBe(false)
  })
})

describe('shouldReactivate — combined conditions', () => {
  it('fires when both threshold exceeded and externalAudit=true', () => {
    const input: ReactivationInput = {
      distinctAuthorCount: 5,
      externalAudit: true,
    }
    expect(shouldReactivate(input)).toBe(true)
  })
})
