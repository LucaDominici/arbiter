// SPDX-License-Identifier: Apache-2.0
// Deterministic seed primitives for arbiter generators (#637, R1.M3).
//
// Scope (matches design decision B):
//   - Generator code paths can use SeededRng / seededClock for byte-identical output.
//   - Tarball entry ordering uses canonicalJsonHash for stable bundles (#639).
//   - Runtime observability (runId, log timestamps, profile filenames) is NOT seeded
//     — each invocation must remain uniquely identifiable.

import { createHash } from 'node:crypto'

export interface SeededRng {
  /** Returns a number in [0, 1). */
  next(): number
  /** Returns a 32-bit unsigned integer. */
  nextU32(): number
  /** Returns an integer in [min, max). */
  nextInt(min: number, max: number): number
}

const UINT32 = 0x1_0000_0000

/**
 * xorshift32 — a fast 32-bit pseudo-random generator. Deterministic for a fixed
 * seed; not cryptographically secure. Suitable for reproducible generator output.
 */
export function createSeededRng(seed: number): SeededRng {
  let state = seed | 0
  if (state === 0) state = 1
  function nextU32(): number {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return state >>> 0
  }
  return {
    next(): number {
      return nextU32() / UINT32
    },
    nextU32,
    nextInt(min: number, max: number): number {
      if (max <= min) throw new Error('nextInt: max must be greater than min')
      const span = max - min
      return min + (nextU32() % span)
    },
  }
}

/**
 * Returns a fixed Date derived from the seed. Use in generator code paths that
 * embed timestamps in output files. Range is bounded to 2020-01-01..2030-12-31.
 */
export function seededClock(seed: number): Date {
  const rng = createSeededRng(seed)
  const start = Date.UTC(2020, 0, 1)
  const span = Date.UTC(2030, 11, 31) - start
  return new Date(start + (rng.nextU32() % span))
}

/**
 * Canonical-JSON SHA-256 of an arbitrary JSON-serializable value. Keys are
 * sorted recursively so the digest is stable across runs regardless of insertion
 * order. Returns the 32-bit truncation as a signed integer suitable for seeding.
 */
export function canonicalJsonHash(value: unknown): number {
  const canonical = canonicalize(value)
  const digest = createHash('sha256').update(canonical).digest()
  return digest.readInt32BE(0)
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v)).join(',')}]`
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`)
  return `{${parts.join(',')}}`
}

/**
 * Derive a seed from the project's arbiter.json content (or any object). Used
 * as the default when --seed is omitted: hash of arbiter.json keeps determinism
 * stable across runs in the same project without requiring an explicit flag.
 */
export function deriveSeedFromConfig(config: unknown): number {
  return canonicalJsonHash(config)
}
