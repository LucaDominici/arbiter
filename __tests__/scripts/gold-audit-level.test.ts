// SPDX-License-Identifier: Apache-2.0
// #1414 — deterministic gold-LEVEL band + "what's missing" gap report. levelBand() maps a
// code-computed score to L0–L3 keyed by brownfieldClass (a heavy legacy repo reaches a given band
// at a lower score than a greenfield gold repo). gapReport() groups the N/P checks by dimension
// (family) with their evidence — the "what's missing" view. Both are pure + deterministic.
import { describe, it, expect } from 'vitest'
import { levelBand, gapReport, evaluate } from '../../scripts/lib/gold-audit-lib.mjs'

describe('levelBand (#1414)', () => {
  it('maps score → L0..L3 with class-specific thresholds', () => {
    // gold (greenfield) is held to the strictest thresholds; heavy (legacy) the most lenient.
    expect(levelBand(100, 'gold').level).toBe('L3')
    expect(levelBand(0, 'gold').level).toBe('L0')
    // A mid score lands lower for gold than for heavy at the same score.
    const goldMid = levelBand(60, 'gold')
    const heavyMid = levelBand(60, 'heavy')
    const order = ['L0', 'L1', 'L2', 'L3']
    expect(order.indexOf(heavyMid.level)).toBeGreaterThanOrEqual(order.indexOf(goldMid.level))
  })

  it('returns the band thresholds + brownfieldClass for transparency', () => {
    const b = levelBand(85, 'light')
    expect(b.brownfieldClass).toBe('light')
    expect(typeof b.level).toBe('string')
    expect(typeof b.nextLevel === 'string' || b.nextLevel === null).toBe(true)
    expect(typeof b.toNextLevel).toBe('number')
  })

  it('is deterministic and clamps unknown class to a default band', () => {
    expect(levelBand(50, 'gold')).toEqual(levelBand(50, 'gold'))
    // an unknown class must not throw — falls back to the strictest (gold) band.
    expect(levelBand(50, 'nonsense').level).toBe(levelBand(50, 'gold').level)
  })
})

const REGISTRY = {
  version: '1.0.0',
  dimensions: [
    { id: 'D-DOCS', title: 'Docs' },
    { id: 'D-ENF', title: 'Enforcement' },
  ],
  checks: [
    { id: 'C1', dimension: 'D-DOCS', title: 'README', type: 'file_exists', args: { path: 'X.md' } },
    { id: 'C2', dimension: 'D-ENF', title: 'gate', type: 'file_exists', args: { path: 'Y.md' } },
    { id: 'C3', dimension: 'D-ENF', title: 'manual', type: 'manual' },
  ],
}

describe('gapReport (#1414)', () => {
  it('groups N/P checks by family with evidence; excludes Y/NA/NV', () => {
    // Empty repo: C1, C2 → N; C3 → NV. Gap report lists only C1, C2, grouped by dimension.
    const result = evaluate(REGISTRY, new Set(), '/nonexistent-repo-root-xyz')
    const gaps = gapReport(result)
    const families = gaps.map((g) => g.dimension).sort()
    expect(families).toEqual(['D-DOCS', 'D-ENF'])
    const enf = gaps.find((g) => g.dimension === 'D-ENF')
    // D-ENF has C2 (N) but NOT C3 (NV — not a gap, code can't verify it).
    expect(enf.checks.map((c) => c.id)).toEqual(['C2'])
    expect(enf.checks[0].verdict).toBe('N')
    expect(enf.checks[0].evidence).toBeTruthy()
  })

  it('returns an empty array when nothing is missing', () => {
    // A registry whose single check is manual (NV) — no N/P → no gaps.
    const allNv = { version: '1', dimensions: [], checks: [{ id: 'M', type: 'manual' }] }
    const result = evaluate(allNv, new Set(), '/tmp')
    expect(gapReport(result)).toEqual([])
  })

  it('is deterministic — stable family + check ordering', () => {
    const result = evaluate(REGISTRY, new Set(), '/nonexistent-repo-root-xyz')
    expect(JSON.stringify(gapReport(result))).toBe(JSON.stringify(gapReport(result)))
  })
})
