// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import {
  createSeededRng,
  seededClock,
  canonicalJsonHash,
  deriveSeedFromConfig,
} from '../../src/utils/seed.js'

describe('createSeededRng', () => {
  it('produces identical sequences for the same seed', () => {
    const a = createSeededRng(42)
    const b = createSeededRng(42)
    const seqA = Array.from({ length: 10 }, () => a.nextU32())
    const seqB = Array.from({ length: 10 }, () => b.nextU32())
    expect(seqA).toEqual(seqB)
  })

  it('produces different sequences for different seeds', () => {
    const a = createSeededRng(42)
    const b = createSeededRng(7)
    expect(a.nextU32()).not.toBe(b.nextU32())
  })

  it('next() stays within [0, 1)', () => {
    const rng = createSeededRng(1)
    for (let i = 0; i < 100; i++) {
      const v = rng.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('nextInt is in [min, max)', () => {
    const rng = createSeededRng(99)
    for (let i = 0; i < 100; i++) {
      const v = rng.nextInt(5, 10)
      expect(v).toBeGreaterThanOrEqual(5)
      expect(v).toBeLessThan(10)
    }
  })

  it('zero seed is normalized (does not stick at 0)', () => {
    const rng = createSeededRng(0)
    const first = rng.nextU32()
    expect(first).not.toBe(0)
  })
})

describe('seededClock', () => {
  it('returns the same Date for the same seed', () => {
    expect(seededClock(123).getTime()).toBe(seededClock(123).getTime())
  })

  it('stays within bounded range 2020..2030', () => {
    for (const seed of [1, 42, 99, 1024]) {
      const d = seededClock(seed)
      expect(d.getUTCFullYear()).toBeGreaterThanOrEqual(2020)
      expect(d.getUTCFullYear()).toBeLessThanOrEqual(2030)
    }
  })

  it('distributes across the full decade range (not bunched at start)', () => {
    // With the old `nextU32() % span` where span ~347B ms > 2^32 (~4.3B ms),
    // every date lands within ~50 days of 2020-01-01. The fix must produce
    // results spread across all years 2020–2030.
    const seeds = Array.from({ length: 100 }, (_, i) => i + 1)
    const years = seeds.map((s) => seededClock(s).getUTCFullYear())
    const uniqueYears = new Set(years)
    // Across 100 seeds the full-range fix should cover at least 5 distinct years.
    expect(uniqueYears.size).toBeGreaterThanOrEqual(5)
  })
})

describe('canonicalJsonHash', () => {
  it('is stable across key insertion order', () => {
    const a = canonicalJsonHash({ a: 1, b: 2, c: 3 })
    const b = canonicalJsonHash({ c: 3, a: 1, b: 2 })
    expect(a).toBe(b)
  })

  it('differs when values differ', () => {
    expect(canonicalJsonHash({ a: 1 })).not.toBe(canonicalJsonHash({ a: 2 }))
  })

  it('handles nested objects deterministically', () => {
    const a = canonicalJsonHash({ outer: { z: 1, a: 2 } })
    const b = canonicalJsonHash({ outer: { a: 2, z: 1 } })
    expect(a).toBe(b)
  })

  it('arrays preserve order (semantic)', () => {
    expect(canonicalJsonHash([1, 2, 3])).not.toBe(canonicalJsonHash([3, 2, 1]))
  })
})

describe('deriveSeedFromConfig', () => {
  it('is byte-stable for equivalent configs', () => {
    const cfg = { language: 'typescript', level: 'L2', tools: ['claude', 'codex'] }
    const cfg2 = { tools: ['claude', 'codex'], level: 'L2', language: 'typescript' }
    expect(deriveSeedFromConfig(cfg)).toBe(deriveSeedFromConfig(cfg2))
  })
})
