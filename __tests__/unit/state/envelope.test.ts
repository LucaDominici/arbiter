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
