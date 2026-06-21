// SPDX-License-Identifier: Apache-2.0
/**
 * Branch-coverage climb for src/gauntlet/ipog.ts (#1486).
 *
 * ipog() is a pure, deterministic, dependency-free t-way test generator — there
 * is no git/gh/fs/spawn/process.exit seam to stub. Every branch is therefore
 * driven purely by crafted inputs through the single public entrypoint `ipog`.
 *
 * This file is additive: it never edits src or the existing
 * __tests__/gauntlet/ipog.test.ts. It targets the defensive fallbacks, the
 * wildcard-fill conditional, the encodeTuple key-sort comparator, the
 * already-covered short-circuits, and the empty-input / clamp guards.
 */

import { describe, it, expect } from 'vitest'
import { ipog } from '../../src/gauntlet/ipog.js'
import type { IpogInput, IpogRow } from '../../src/gauntlet/ipog.js'

// ── helpers (local; do not touch the sibling suite) ──────────────────────────

function combos<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (arr.length < k) return []
  const [head, ...tail] = arr
  const withHead: T[][] = combos(tail, k - 1).map((rest: T[]) => [head as T, ...rest])
  return [...withHead, ...combos(tail, k)]
}

function product(slots: string[][]): string[][] {
  if (slots.length === 0) return [[]]
  const [first, ...rest] = slots
  const restProd: string[][] = product(rest)
  const out: string[][] = []
  for (const v of first ?? []) {
    for (const r of restProd) out.push([v, ...r])
  }
  return out
}

function excluded(input: IpogInput, constraint: Record<string, string>): boolean {
  if (!input.constraints) return false
  return input.constraints.some(
    (c) =>
      c.then === 'skip' && Object.entries(c.when).every(([k, v]: [string, string]) => constraint[k] === v),
  )
}

/** Assert every t-way value combination appears in at least one (non-excluded) row. */
function assertAllTuplesCovered(input: IpogInput, rows: IpogRow[], t: number): void {
  const params = Object.keys(input.dimensions)
  for (const subset of combos(params, t)) {
    const slots: string[][] = subset.map((p: string) => input.dimensions[p] ?? [])
    for (const tuple of product(slots)) {
      const constraint: Record<string, string> = {}
      for (let i = 0; i < subset.length; i++) {
        const key = subset[i]
        const val = tuple[i]
        if (key !== undefined && val !== undefined) constraint[key] = val
      }
      if (excluded(input, constraint)) continue
      const covered = rows.some((row: IpogRow) =>
        subset.every((p: string) => row[p] === constraint[p]),
      )
      expect(covered, `missing tuple ${JSON.stringify(constraint)}`).toBe(true)
    }
  }
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('ipog() — empty and degenerate inputs', () => {
  it('returns [] when there are no dimensions (params.length === 0)', () => {
    const input: IpogInput = { dimensions: {}, strength: 2 }
    expect(ipog(input)).toEqual([])
  })

  it('clamps strength below 1 up to 1 (single param, strength 0)', () => {
    const input: IpogInput = { dimensions: { only: ['a', 'b'] }, strength: 0 }
    const rows = ipog(input)
    // t is clamped to max(1, min(0, 1)) === 1 → one row per value via cross-product.
    expect(rows.map((r: IpogRow) => r['only']).sort()).toEqual(['a', 'b'])
  })

  it('clamps strength above param count down to param count (early cross-product path)', () => {
    // params.length (2) <= t, so the params.length <= t early-return branch fires.
    const input: IpogInput = { dimensions: { a: ['1', '2'], b: ['x', 'y'] }, strength: 9 }
    const rows = ipog(input)
    expect(rows.length).toBe(4) // full cross-product
    assertAllTuplesCovered(input, rows, 2)
  })

  it('handles a dimension whose value list is empty on the <= t path', () => {
    // `b` has no values; the params.length <= t cross-product collapses to [].
    const input: IpogInput = { dimensions: { a: ['1', '2'], b: [] }, strength: 2 }
    expect(ipog(input)).toEqual([])
  })

  it('handles an empty-value dimension in the extension path (pickBestValue fallback)', () => {
    // 4 params (> strength) forces the t-way extension path. The empty `c` array
    // drives pickBestValue's `values[0] ?? ''` fallback (line 97), assigning '' to
    // that slot rather than throwing.
    const input: IpogInput = {
      dimensions: { a: ['1', '2'], b: ['x', 'y'], c: [], d: ['m', 'n'] },
      strength: 2,
    }
    const rows = ipog(input)
    expect(rows.length).toBeGreaterThan(0)
    // Every row's empty-dimension slot is the '' fallback, never undefined.
    for (const row of rows) {
      expect(row['c']).toBe('')
    }
  })

  it('handles an empty-value dimension as the final param in the extension path', () => {
    const input: IpogInput = {
      dimensions: { a: ['1', '2'], b: ['x', 'y'], c: ['p', 'q'], d: [] },
      strength: 2,
    }
    const rows = ipog(input)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row['d']).toBe('')
    }
  })
})

describe('ipog() — early cross-product path with constraints (filterConstraints true branch)', () => {
  it('drops rows matching a skip constraint on the <= t path', () => {
    const input: IpogInput = {
      dimensions: { a: ['1', '2'], b: ['x', 'y'] },
      strength: 2,
      constraints: [{ when: { a: '1', b: 'x' }, then: 'skip' }],
    }
    const rows = ipog(input)
    expect(rows.length).toBe(3)
    expect(rows.some((r: IpogRow) => r['a'] === '1' && r['b'] === 'x')).toBe(false)
  })
})

describe('ipog() — horizontal + vertical extension', () => {
  it('4 params × 3 values, strength 2: completion leaves no wildcard or undefined slot', () => {
    // With 4 params and strength 2, both horizontal and vertical extension run.
    // The completion pass (line 85) must resolve every slot to a real value — the
    // `: val` arm runs for each filled slot; the WILD/undefined fallback never
    // survives here because later params always horizontally-extend earlier rows.
    const input: IpogInput = {
      dimensions: {
        a: ['1', '2', '3'],
        b: ['x', 'y', 'z'],
        c: ['p', 'q', 'r'],
        d: ['m', 'n', 'o'],
      },
      strength: 2,
    }
    const rows = ipog(input)
    // Every completed row must have every param assigned to a real value (no '*').
    for (const row of rows) {
      for (const p of Object.keys(input.dimensions)) {
        expect(input.dimensions[p]).toContain(row[p])
      }
    }
    assertAllTuplesCovered(input, rows, 2)
    expect(rows.length).toBeGreaterThan(9)
  })

  it('5 params, skewed value counts, strength 2: stresses already-covered short-circuits', () => {
    // A first param with many values pre-covers tuples for later params, so the
    // isAlreadyCovered() true branch (line 192) and the !isAlreadyCovered false
    // branch (line 182) both fire.
    const input: IpogInput = {
      dimensions: {
        a: ['1', '2', '3', '4'],
        b: ['x', 'y'],
        c: ['p', 'q'],
        d: ['m', 'n'],
        e: ['s', 't'],
      },
      strength: 2,
    }
    const rows = ipog(input)
    assertAllTuplesCovered(input, rows, 2)
    // Deterministic across calls.
    expect(JSON.stringify(ipog(input))).toBe(JSON.stringify(rows))
  })
})

describe('ipog() — encodeTuple key sort comparator (a > b branch)', () => {
  it('descending-named params force the sort comparator down both ordering arms', () => {
    // Param iteration order is z, a → tuples are built as {z, a}; encodeTuple sorts
    // keys, so the comparator sees ('z','a') (a > b → returns 1) and ('a','z')
    // (a < b → returns -1). 4 params ensures the t-way / extension path is taken
    // (not the <= t early return).
    const input: IpogInput = {
      dimensions: {
        z: ['1', '2'],
        y: ['p', 'q'],
        b: ['x', 'w'],
        a: ['m', 'n'],
      },
      strength: 2,
    }
    const rows = ipog(input)
    assertAllTuplesCovered(input, rows, 2)
    expect(rows.length).toBeGreaterThan(0)
  })
})

describe('ipog() — 3-way strength with extension (param count > t)', () => {
  it('covers all triples when params (5) exceed strength (3)', () => {
    const input: IpogInput = {
      dimensions: {
        a: ['1', '2', '3'],
        b: ['x', 'y'],
        c: ['p', 'q'],
        d: ['m', 'n'],
        e: ['s', 't'],
      },
      strength: 3,
    }
    const rows = ipog(input)
    assertAllTuplesCovered(input, rows, 3)
  })

  it('3-way with a constraint pruning some triples after extension', () => {
    const input: IpogInput = {
      dimensions: {
        a: ['1', '2', '3'],
        b: ['x', 'y'],
        c: ['p', 'q'],
        d: ['m', 'n'],
      },
      strength: 3,
      constraints: [{ when: { a: '1', b: 'x', c: 'p' }, then: 'skip' }],
    }
    const rows = ipog(input)
    // The skip constraint must be honoured. Note: row-level constraint pruning
    // can also drop a row that incidentally covered an unrelated, non-excluded
    // tuple, so full t-way coverage is intentionally NOT asserted here — only
    // that no surviving row matches the forbidden triple.
    for (const row of rows) {
      const hit = row['a'] === '1' && row['b'] === 'x' && row['c'] === 'p'
      expect(hit).toBe(false)
    }
    expect(rows.length).toBeGreaterThan(0)
  })
})
