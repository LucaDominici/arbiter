/**
 * IPOG pairwise algorithm tests (#260).
 *
 * Validates that the IPOG implementation produces a correct and minimal
 * pairwise covering set (every 2-way combination of parameter values
 * appears in at least one test case).
 */

import { describe, it, expect } from 'vitest'
import { ipog } from '../../src/gauntlet/ipog.js'
import type { IpogInput } from '../../src/gauntlet/ipog.js'

describe('ipog() — 2-way pairwise (#260, AC-2)', () => {
  it('3 params × 3 values: all pairs covered', () => {
    const input: IpogInput = {
      dimensions: {
        transport: ['car', 'train', 'plane'],
        duration: ['1d', '3d', '7d'],
        travelers: ['solo', 'couple', 'family'],
      },
      strength: 2,
    }
    const rows = ipog(input)
    // All 2-way pairs must appear
    assertAllPairsCovered(input, rows, 2)
    // Row count must be ≤ brute-force max (3³ = 27)
    expect(rows.length).toBeLessThanOrEqual(27)
    // IPOG should produce ≤ 12 rows for this classic case (optimal is 9, greedy may use more)
    expect(rows.length).toBeLessThanOrEqual(12)
  })

  it('output is deterministic across calls', () => {
    const input: IpogInput = {
      dimensions: {
        a: ['1', '2'],
        b: ['x', 'y'],
        c: ['p', 'q', 'r'],
      },
      strength: 2,
    }
    const rows1 = ipog(input)
    const rows2 = ipog(input)
    expect(JSON.stringify(rows1)).toBe(JSON.stringify(rows2))
  })

  it('single param: one row per value', () => {
    const input: IpogInput = {
      dimensions: { x: ['a', 'b', 'c'] },
      strength: 2,
    }
    const rows = ipog(input)
    expect(rows.length).toBe(3)
    const values = rows.map((r) => r['x'])
    expect(values.sort()).toEqual(['a', 'b', 'c'])
  })

  it('two params: cross-product (≤ max(|a|,|b|) * max-extension)', () => {
    const input: IpogInput = {
      dimensions: { a: ['1', '2'], b: ['x', 'y', 'z'] },
      strength: 2,
    }
    const rows = ipog(input)
    assertAllPairsCovered(input, rows, 2)
    expect(rows.length).toBeLessThanOrEqual(6)
  })

  it('respects constraints — skip pairs excluded', () => {
    const input: IpogInput = {
      dimensions: {
        transport: ['car', 'train', 'plane'],
        duration: ['1d', '3d', '7d'],
      },
      strength: 2,
      constraints: [{ when: { transport: 'plane', duration: '1d' }, then: 'skip' }],
    }
    const rows = ipog(input)
    for (const row of rows) {
      const forbidden = row['transport'] === 'plane' && row['duration'] === '1d'
      expect(forbidden).toBe(false)
    }
  })

  it('3-way strength: all triples covered', () => {
    const input: IpogInput = {
      dimensions: {
        a: ['1', '2', '3'],
        b: ['x', 'y'],
        c: ['p', 'q'],
      },
      strength: 3,
    }
    const rows = ipog(input)
    assertAllPairsCovered(input, rows, 3)
  })
})

// ── helpers ─────────────────────────────────────────────────────────────────

type Row = Record<string, string>

/**
 * Assert that every t-way combination of parameter values appears in at
 * least one row.  This is O(n^t * rows) but fine for small test fixtures.
 */
function assertAllPairsCovered(
  input: IpogInput,
  rows: Row[],
  t: number,
): void {
  const params = Object.keys(input.dimensions)
  // Enumerate all t-subsets of params
  for (const subset of combinations(params, t)) {
    const valueSlots = subset.map((p) => input.dimensions[p]!)
    // Enumerate all t-tuples across those params
    for (const tuple of cartesian(valueSlots)) {
      // Build a constraint object
      const constraint: Record<string, string> = {}
      for (let i = 0; i < subset.length; i++) {
        constraint[subset[i]!] = tuple[i]!
      }
      // Is this tuple covered (ignored if excluded by a constraint)?
      if (isExcluded(input, constraint)) continue
      const covered = rows.some((row) => subset.every((p) => row[p] === constraint[p]))
      if (!covered) {
        throw new Error(
          `Missing t-way combination: ${JSON.stringify(constraint)}`,
        )
      }
    }
  }
}

function isExcluded(input: IpogInput, constraint: Record<string, string>): boolean {
  if (!input.constraints) return false
  return input.constraints.some((c) => {
    const whenMatch = Object.entries(c.when).every(([k, v]) => constraint[k] === v)
    return whenMatch && c.then === 'skip'
  })
}

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (arr.length < k) return []
  const [head, ...tail] = arr
  return [
    ...combinations(tail, k - 1).map((rest) => [head!, ...rest]),
    ...combinations(tail, k),
  ]
}

function cartesian(slots: string[][]): string[][] {
  if (slots.length === 0) return [[]]
  const [first, ...rest] = slots
  const restProd = cartesian(rest)
  const result: string[][] = []
  for (const v of first!) {
    for (const r of restProd) {
      result.push([v, ...r])
    }
  }
  return result
}
