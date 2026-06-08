// SPDX-License-Identifier: Apache-2.0
//
// #1260 — size resolution adapter: explicit --tier > diff(files+LOC) > units > default.
// Mirrors src/affinity/gh-issues.ts (injectable gatherer; never throws — degrades to default).
import { describe, it, expect } from 'vitest'
import { resolveShipTier, type DiffStatGatherer } from '../../src/sizing/diff-signals.js'

const bigDiff: DiffStatGatherer = () => ({ filesChanged: 12, linesChanged: 600 })
const tinyDiff: DiffStatGatherer = () => ({ filesChanged: 1, linesChanged: 6 })
const noDiff: DiffStatGatherer = () => ({ filesChanged: 0, linesChanged: 0 })
const throwingDiff: DiffStatGatherer = () => {
  throw new Error('git unavailable')
}

describe('resolveShipTier — fallback chain', () => {
  it('explicit tier overrides everything (the rare override)', () => {
    const r = resolveShipTier({ explicitTier: 'XS', gather: bigDiff })
    expect(r.tier).toBe('XS')
    expect(r.source).toBe('explicit')
  })

  it('uses the diff signal when no explicit tier', () => {
    const r = resolveShipTier({ gather: bigDiff })
    expect(r.tier).toBe('Standard')
    expect(r.source).toBe('diff')
  })

  it('falls back to units when the diff is empty', () => {
    const r = resolveShipTier({ gather: noDiff, units: 25 })
    expect(r.tier).toBe('Standard')
    expect(r.source).toBe('units')
  })

  it('FAIL-SAFE: no diff, no units → default WIDEST tier, source=default', () => {
    const r = resolveShipTier({ gather: noDiff })
    expect(r.tier).toBe('Standard')
    expect(r.source).toBe('default')
  })

  it('NEVER throws when the gatherer fails — degrades to units then default', () => {
    expect(() => resolveShipTier({ gather: throwingDiff })).not.toThrow()
    const r = resolveShipTier({ gather: throwingDiff, units: 3 })
    expect(r.tier).toBe('XS')
    expect(r.source).toBe('units')
    const r2 = resolveShipTier({ gather: throwingDiff })
    expect(r2.tier).toBe('Standard')
    expect(r2.source).toBe('default')
  })

  it('a tiny real diff yields XS without any flag (always auto-computed)', () => {
    const r = resolveShipTier({ gather: tinyDiff })
    expect(r.tier).toBe('XS')
    expect(r.source).toBe('diff')
  })

  it('exposes the computed verticals alongside the tier (the #1267 consumption point)', () => {
    const r = resolveShipTier({ gather: bigDiff })
    expect(r.verticals).toContain('security')
    expect(r.verticals).toContain('data-integrity')
  })
})
