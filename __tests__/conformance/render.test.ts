// SPDX-License-Identifier: Apache-2.0
// TDD red: units 8 + 9 for #1393 — computeSummary Y/P/N/NA/NV scale + renderText evidence rendering.
// These tests fail against the current pass/partial/fail/skip implementation.
import { describe, it, expect } from 'vitest'
import { computeSummary, renderText } from '../../src/conformance/render.js'
import type { DimensionEntry } from '../../src/conformance/dimensions.js'

function makeDim(
  id: string,
  verdict: string,
  evidence: { file: string; line?: number; detail?: string },
): DimensionEntry {
  return {
    id,
    title: id,
    family: 'reality-contact',
    tier: 1,
    weight: 0,
    required_at: 'L1',
    verdict: verdict as DimensionEntry['verdict'],
    evidence,
  }
}

describe('computeSummary — Y/P/N/NA/NV scale (#1393 unit 8)', () => {
  it('returns y, p, n, na, nv fields (not pass, partial, fail, skip)', () => {
    const dims: DimensionEntry[] = [makeDim('D-1', 'Y', { file: 'ok.json' })]
    const summary = computeSummary(dims)

    expect(summary).toHaveProperty('y')
    expect(summary).toHaveProperty('p')
    expect(summary).toHaveProperty('n')
    expect(summary).toHaveProperty('na')
    expect(summary).toHaveProperty('nv')
    expect(summary).not.toHaveProperty('pass')
    expect(summary).not.toHaveProperty('fail')
    expect(summary).not.toHaveProperty('partial')
    expect(summary).not.toHaveProperty('skip')
  })

  it('counts Y/P/N/NA/NV correctly', () => {
    const dims: DimensionEntry[] = [
      makeDim('D-1', 'Y', { file: 'ok.json' }),
      makeDim('D-2', 'P', { file: 'partial.json' }),
      makeDim('D-3', 'N', { file: 'fail.json' }),
      makeDim('D-4', 'NA', { file: 'na.json' }),
      makeDim('D-5', 'NV', { file: 'nv.json' }),
    ]
    const summary = computeSummary(dims)

    expect(summary.y).toBe(1)
    expect(summary.p).toBe(1)
    expect(summary.n).toBe(1)
    expect(summary.na).toBe(1)
    expect(summary.nv).toBe(1)
    expect(summary.total).toBe(5)
  })

  it('excludes NA and NV from score denominator', () => {
    const dims: DimensionEntry[] = [
      makeDim('D-1', 'Y', { file: 'ok.json' }),
      makeDim('D-2', 'NA', { file: 'na.json' }),
      makeDim('D-3', 'NV', { file: 'nv.json' }),
    ]
    const summary = computeSummary(dims)

    // denominator = y + p + n = 1; earned = 1 + 0 + 0 = 1 → score = 100
    expect(summary.score).toBe(100)
  })

  it('returns score 0 when all dimensions are NA (no applicable checks)', () => {
    const dims: DimensionEntry[] = [
      makeDim('D-1', 'NA', { file: 'na.json' }),
      makeDim('D-2', 'NA', { file: 'na.json' }),
    ]
    const summary = computeSummary(dims)

    // applicable = 0 → score = 0 (not 100, per engine.ts contract)
    expect(summary.score).toBe(0)
  })

  it('score = 50 when one Y and one N with no NA/NV', () => {
    const dims: DimensionEntry[] = [
      makeDim('D-1', 'Y', { file: 'ok.json' }),
      makeDim('D-2', 'N', { file: 'fail.json' }),
    ]
    const summary = computeSummary(dims)

    expect(summary.score).toBe(50)
  })

  it('score formula: Math.round((earned / applicable) * 1000) / 10', () => {
    // 2Y + 1N → earned=2, applicable=3 → 2/3 * 100 = 66.666... → 66.7
    const dims: DimensionEntry[] = [
      makeDim('D-1', 'Y', { file: 'ok.json' }),
      makeDim('D-2', 'Y', { file: 'ok.json' }),
      makeDim('D-3', 'N', { file: 'fail.json' }),
    ]
    const summary = computeSummary(dims)

    expect(summary.score).toBe(66.7)
  })
})

describe('renderText — evidence rendering (#1393 unit 9)', () => {
  it('renders Evidence object with detail as "file — detail" (not [object Object])', () => {
    const dims: DimensionEntry[] = [makeDim('D-1', 'Y', { file: 'README.md', detail: 'present' })]
    const summary = computeSummary(dims)
    const text = renderText(dims, summary)

    expect(text).toContain('README.md')
    expect(text).toContain('present')
    expect(text).not.toContain('[object Object]')
  })

  it('renders Evidence object as "file:line" (not [object Object])', () => {
    const dims: DimensionEntry[] = [makeDim('D-1', 'Y', { file: 'src/index.ts', line: 42 })]
    const summary = computeSummary(dims)
    const text = renderText(dims, summary)

    expect(text).toContain('src/index.ts')
    expect(text).not.toContain('[object Object]')
  })

  it('renders Evidence object without line as just file path', () => {
    const dims: DimensionEntry[] = [makeDim('D-1', 'Y', { file: 'README.md' })]
    const summary = computeSummary(dims)
    const text = renderText(dims, summary)

    expect(text).toContain('README.md')
    expect(text).not.toContain('[object Object]')
  })

  it('score label uses y/p/n/na/nv fields (not pass/fail)', () => {
    const dims: DimensionEntry[] = [
      makeDim('D-1', 'Y', { file: 'ok.json' }),
      makeDim('D-2', 'N', { file: 'fail.json' }),
      makeDim('D-3', 'NA', { file: 'na.json' }),
    ]
    const summary = computeSummary(dims)
    const text = renderText(dims, summary)

    expect(text).toMatch(/\bY\b/)
    expect(text).toMatch(/\bN\b/)
    expect(text).toMatch(/\bNA\b/)
    expect(text).not.toContain('PASS')
    expect(text).not.toContain('FAIL')
  })
})
