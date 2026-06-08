// SPDX-License-Identifier: Apache-2.0
//
// #1260 — pure ship-SIZE scorer: change signals → review tier + orthogonal vertical floor.
// Size is ALWAYS computed (no flag); larger size widens BOTH the review-agent count
// (via tier) AND the breadth of review verticals. Re-derived from viafera /task size +
// plan-review-verticals (NOT copied; uses arbiter's own auditor-routing vocabulary).
import { describe, it, expect } from 'vitest'
import {
  computeShipSize,
  sizeVerticals,
  DEFAULT_SHIP_TIER,
  type SizeSignals,
} from '../../src/sizing/sizing.js'

describe('computeShipSize — change signals → tier', () => {
  it('a tiny change (few files, low LOC) is XS', () => {
    const s: SizeSignals = { filesChanged: 1, linesChanged: 8 }
    expect(computeShipSize(s).tier).toBe('XS')
  })

  it('a medium change is S', () => {
    const s: SizeSignals = { filesChanged: 4, linesChanged: 120 }
    expect(computeShipSize(s).tier).toBe('S')
  })

  it('a large change is Standard', () => {
    const s: SizeSignals = { filesChanged: 12, linesChanged: 600 }
    expect(computeShipSize(s).tier).toBe('Standard')
  })

  it('units are the fallback signal when no diff is available', () => {
    expect(computeShipSize({ units: 2 }).tier).toBe('XS')
    expect(computeShipSize({ units: 8 }).tier).toBe('S')
    expect(computeShipSize({ units: 25 }).tier).toBe('Standard')
  })

  it('FAIL-SAFE: no signal at all defaults to the WIDEST tier (Standard), never XS', () => {
    expect(computeShipSize({}).tier).toBe('Standard')
    expect(DEFAULT_SHIP_TIER).toBe('Standard')
  })

  it('diff signal takes precedence over units', () => {
    // small diff but large units → diff wins (XS)
    expect(computeShipSize({ filesChanged: 1, linesChanged: 5, units: 50 }).tier).toBe('XS')
  })
})

describe('sizeVerticals — orthogonal breadth widens with size', () => {
  // The vocabulary MUST be real auditor-routing.json auditor names so the floor
  // plugs into route-auditors.mjs and #1267's dispatch matrix.
  const AUDITOR_VOCAB = [
    'bugs',
    'type-safety',
    'domain',
    'test-quality',
    'security',
    'data-integrity',
    'silent-failures',
  ]

  it('XS floor = always_on triad only', () => {
    expect(sizeVerticals('XS')).toEqual(['bugs', 'type-safety', 'domain'])
  })

  it('S widens the floor beyond XS', () => {
    const xs = sizeVerticals('XS')
    const s = sizeVerticals('S')
    expect(s.length).toBeGreaterThan(xs.length)
    expect(s).toEqual(expect.arrayContaining(xs))
  })

  it('Standard is the widest floor (full breadth) and strictly widens S', () => {
    const s = sizeVerticals('S')
    const std = sizeVerticals('Standard')
    expect(std.length).toBeGreaterThan(s.length)
    expect(std).toEqual(expect.arrayContaining(s))
  })

  it('every floor vertical is a real auditor name (no dead/free-text taxonomy)', () => {
    for (const t of ['XS', 'S', 'Standard'] as const) {
      for (const v of sizeVerticals(t)) {
        expect(AUDITOR_VOCAB).toContain(v)
      }
    }
  })

  it('computeShipSize bundles the matching vertical floor with the tier', () => {
    const r = computeShipSize({ filesChanged: 12, linesChanged: 600 })
    expect(r.tier).toBe('Standard')
    expect(r.verticals).toEqual(sizeVerticals('Standard'))
  })
})
