// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import {
  CURRENT_SNAPSHOT_VERSION,
  canonicalJson,
  computeChecksum,
  unwrapSnapshot,
  wrapSnapshot,
  SnapshotChecksumError,
  SnapshotShapeError,
} from '../../../src/state/envelope.js'

describe('canonicalJson', () => {
  it('sorts object keys deterministically', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{\n  "a": 2,\n  "b": 1\n}')
  })
  it('handles nested objects', () => {
    expect(canonicalJson({ z: { b: 2, a: 1 } })).toContain('"a": 1')
  })
  it('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[\n  3,\n  1,\n  2\n]')
  })
  it('orders non-ASCII keys by codepoint, NOT locale collation (#1601)', () => {
    // Under a codepoint sort, the second char decides: 'z' (U+007A) < 'ö' (U+00F6),
    // and 'az' is a prefix of 'az_b'. A locale collator (e.g. en-US) instead folds
    // 'ö'→'o' and would emit [aö, az, az_b] — a locale-dependent, non-deterministic
    // byte layout for an integrity-critical serializer.
    const out = canonicalJson({ aö: 1, az: 2, az_b: 3 })
    const order = [...out.matchAll(/"([^"]+)":/g)].map((m) => m[1])
    expect(order).toEqual(['az', 'az_b', 'aö'])
  })
  it('checksum is identical to an explicit codepoint sort (locale-proof, #1601)', () => {
    const obj = { aö: 1, az: 2, az_b: 3, 'a-b': 4 }
    const expected = JSON.stringify(
      Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
      null,
      2,
    )
    expect(canonicalJson(obj)).toBe(expected)
  })
})

describe('computeChecksum + wrapSnapshot', () => {
  it('produces deterministic 64-hex output', () => {
    const c = computeChecksum({ $schemaVersion: 1, config: { a: 1 } })
    expect(c).toMatch(/^[0-9a-f]{64}$/)
  })
  it('different config → different checksum', () => {
    const a = computeChecksum({ $schemaVersion: 1, config: { x: 1 } })
    const b = computeChecksum({ $schemaVersion: 1, config: { x: 2 } })
    expect(a).not.toBe(b)
  })
  it('checksum stable under key reordering of input', () => {
    const a = computeChecksum({ $schemaVersion: 1, config: { a: 1, b: 2 } })
    const b = computeChecksum({ $schemaVersion: 1, config: { b: 2, a: 1 } })
    expect(a).toBe(b)
  })
  it('wrapSnapshot returns envelope with .checksum at top', () => {
    const w = wrapSnapshot({ name: 'x' })
    expect(w['.checksum']).toMatch(/^[0-9a-f]{64}$/)
    expect(w.$schemaVersion).toBe(CURRENT_SNAPSHOT_VERSION)
    expect(w.config).toEqual({ name: 'x' })
  })
})

describe('unwrapSnapshot', () => {
  it('round-trip wrap → unwrap returns equivalent envelope', () => {
    const w = wrapSnapshot({ k: 'v' })
    const { envelope } = unwrapSnapshot<{ k: string }>(w)
    expect(envelope.config).toEqual({ k: 'v' })
    expect(envelope.$schemaVersion).toBe(1)
  })
  it('throws SnapshotChecksumError on tamper', () => {
    const w = wrapSnapshot({ k: 'v' })
    const tampered = { ...w, config: { k: 'EVIL' } }
    expect(() => unwrapSnapshot(tampered)).toThrow(SnapshotChecksumError)
  })
  it('throws SnapshotShapeError on missing .checksum', () => {
    expect(() => unwrapSnapshot({ $schemaVersion: 1, config: {} })).toThrow(SnapshotShapeError)
  })
  it('throws SnapshotShapeError on missing $schemaVersion', () => {
    expect(() => unwrapSnapshot({ '.checksum': 'x', config: {} })).toThrow(SnapshotShapeError)
  })
  it('throws SnapshotShapeError on missing config', () => {
    expect(() => unwrapSnapshot({ '.checksum': 'x', $schemaVersion: 1 })).toThrow(
      SnapshotShapeError,
    )
  })
  it('throws SnapshotShapeError on non-object input', () => {
    expect(() => unwrapSnapshot(42)).toThrow(SnapshotShapeError)
  })
})
