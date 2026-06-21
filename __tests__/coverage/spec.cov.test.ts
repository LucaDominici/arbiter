// SPDX-License-Identifier: Apache-2.0
/**
 * Coverage tests for src/gauntlet/spec.ts (#1483 coverage ratchet).
 *
 * Exercises the two exported functions — parseSpec() and specHash() — across
 * the full set of validation branches and the bespoke minimal-YAML parser
 * (block maps, block sequences, inline flow maps/seqs, quoting, comments,
 * scalars, and the various error paths). The module is pure (no filesystem,
 * no network, no clock), so the tests are fully deterministic.
 */

import { describe, it, expect } from 'vitest'
import { parseSpec, specHash } from '../../src/gauntlet/spec.js'
import type { ParseSpecResult, GauntletSpec } from '../../src/gauntlet/spec.js'

/** Narrow a ParseSpecResult to its ok-spec, failing the test otherwise. */
function expectOk(res: ParseSpecResult): GauntletSpec {
  expect(res.ok).toBe(true)
  if (!res.ok) throw new Error(`expected ok result, got: ${res.reason}`)
  return res.spec
}

/** Narrow a ParseSpecResult to its failure reason, failing the test otherwise. */
function expectErr(res: ParseSpecResult): string {
  expect(res.ok).toBe(false)
  if (res.ok) throw new Error('expected failure result, got ok')
  return res.reason
}

describe('parseSpec() — happy paths', () => {
  it('parses a full spec with block-mapping dimensions, strategy, constraints, tags', () => {
    const raw = [
      'name: trip-form',
      'dimensions:',
      '  transport: [car, train, plane]',
      '  duration: [1d, 3d, 7d]',
      'strategy: pairwise',
      'constraints:',
      '  - when: { transport: plane, duration: 1d }',
      '    then: skip',
      'tags: ["@gauntlet"]',
    ].join('\n')
    const spec = expectOk(parseSpec(raw))
    expect(spec.name).toBe('trip-form')
    expect(spec.dimensions).toEqual({
      transport: ['car', 'train', 'plane'],
      duration: ['1d', '3d', '7d'],
    })
    expect(spec.strategy).toBe('pairwise')
    expect(spec.constraints).toEqual([{ when: { transport: 'plane', duration: '1d' }, then: 'skip' }])
    expect(spec.tags).toEqual(['@gauntlet'])
  })

  it('defaults strategy to pairwise when omitted, and constraints/tags to empty arrays', () => {
    const raw = ['name: minimal', 'dimensions:', '  a: [x, y]'].join('\n')
    const spec = expectOk(parseSpec(raw))
    expect(spec.strategy).toBe('pairwise')
    expect(spec.constraints).toEqual([])
    expect(spec.tags).toEqual([])
  })

  it('accepts the 3-way strategy', () => {
    const raw = ['name: threeway', 'dimensions:', '  a: [x, y]', 'strategy: 3-way'].join('\n')
    const spec = expectOk(parseSpec(raw))
    expect(spec.strategy).toBe('3-way')
  })

  it('parses a block-sequence constraint with an inline-flow when map', () => {
    const raw = [
      'name: blockseq',
      'dimensions:',
      '  a: [x, y]',
      '  b: [p, q]',
      'constraints:',
      '  - when: { a: x, b: p }',
      '    then: skip',
      '  - when: { a: y, b: q }',
      '    then: skip',
    ].join('\n')
    const spec = expectOk(parseSpec(raw))
    expect(spec.constraints).toHaveLength(2)
    expect(spec.constraints[0]).toEqual({ when: { a: 'x', b: 'p' }, then: 'skip' })
    expect(spec.constraints[1]).toEqual({ when: { a: 'y', b: 'q' }, then: 'skip' })
  })

  it('parses dimensions given as block-style sequences (dash items)', () => {
    const raw = [
      'name: blockdims',
      'dimensions:',
      '  colors:',
      '    - red',
      '    - green',
      '    - blue',
    ].join('\n')
    const spec = expectOk(parseSpec(raw))
    expect(spec.dimensions).toEqual({ colors: ['red', 'green', 'blue'] })
  })

  it('parses quoted dimension keys and values, and strips comments', () => {
    const raw = [
      '# leading comment',
      'name: "quoted name"   # trailing comment',
      'dimensions:',
      "  'os': ['linux', 'mac', 'win']  # the platforms",
      'tags: ["@a", "@b"]',
    ].join('\n')
    const spec = expectOk(parseSpec(raw))
    expect(spec.name).toBe('quoted name')
    expect(spec.dimensions).toEqual({ os: ['linux', 'mac', 'win'] })
    expect(spec.tags).toEqual(['@a', '@b'])
  })

  it('ignores blank lines and full-line comments between entries', () => {
    const raw = [
      '',
      '# a comment',
      'name: spaced',
      '',
      'dimensions:',
      '',
      '  a: [x, y]',
      '# trailing comment',
    ].join('\n')
    const spec = expectOk(parseSpec(raw))
    expect(spec.name).toBe('spaced')
    expect(spec.dimensions).toEqual({ a: ['x', 'y'] })
  })

  it('handles a tag list with empty/whitespace entries filtered by the flow-seq parser', () => {
    const raw = ['name: t', 'dimensions:', '  a: [x]', 'tags: [, "@one", ]'].join('\n')
    const spec = expectOk(parseSpec(raw))
    expect(spec.tags).toEqual(['@one'])
  })

  it('parses a scalar value whose child is an indented block (nested mapping value)', () => {
    const raw = [
      'name: nested',
      'dimensions:',
      '  a: [x, y]',
      'meta:',
      '  owner: alice',
    ].join('\n')
    // meta is parsed but ignored by the spec validator; the point is the
    // nested-block branch of parseBlockMap is exercised without error.
    const spec = expectOk(parseSpec(raw))
    expect(spec.name).toBe('nested')
  })
})

describe('parseSpec() — top-level structural failures', () => {
  it('rejects a YAML scalar (not an object)', () => {
    expect(expectErr(parseSpec('just-a-scalar'))).toBe('spec must be a YAML object')
  })

  it('rejects an empty document (parses to null)', () => {
    expect(expectErr(parseSpec(''))).toBe('spec must be a YAML object')
  })

  it('rejects a top-level sequence', () => {
    expect(expectErr(parseSpec('- one\n- two'))).toBe('spec must be a YAML object')
  })
})

describe('parseSpec() — name validation', () => {
  it('rejects a missing name', () => {
    expect(expectErr(parseSpec('dimensions:\n  a: [x]'))).toBe('spec.name is required (string)')
  })

  it('rejects an empty/whitespace name', () => {
    const raw = ['name: "   "', 'dimensions:', '  a: [x]'].join('\n')
    expect(expectErr(parseSpec(raw))).toBe('spec.name is required (string)')
  })

  it('rejects a non-string name (a sequence)', () => {
    const raw = ['name: [a, b]', 'dimensions:', '  a: [x]'].join('\n')
    expect(expectErr(parseSpec(raw))).toBe('spec.name is required (string)')
  })
})

describe('parseSpec() — dimensions validation', () => {
  it('rejects a missing dimensions key', () => {
    expect(expectErr(parseSpec('name: nodim'))).toBe('spec.dimensions is required (object)')
  })

  it('rejects dimensions whose value is not an object', () => {
    const raw = ['name: x', 'dimensions: nope'].join('\n')
    expect(expectErr(parseSpec(raw))).toBe('spec.dimensions is required (object)')
  })

  it('rejects an empty dimensions object', () => {
    const raw = ['name: x', 'dimensions: {}'].join('\n')
    expect(expectErr(parseSpec(raw))).toBe('spec.dimensions must have at least one parameter')
  })

  it('rejects a dimension that is not an array', () => {
    const raw = ['name: x', 'dimensions:', '  a: scalar'].join('\n')
    expect(expectErr(parseSpec(raw))).toBe('spec.dimensions.a must be an array of strings')
  })

  it('rejects a dimension array containing a non-string element', () => {
    // A nested flow-map element makes the array contain a non-string.
    const raw = ['name: x', 'dimensions:', '  a:', '    - x', '    - p: q'].join('\n')
    expect(expectErr(parseSpec(raw))).toBe('spec.dimensions.a must be an array of strings')
  })

  it('rejects an empty dimension array', () => {
    const raw = ['name: x', 'dimensions:', '  a: []'].join('\n')
    expect(expectErr(parseSpec(raw))).toBe('spec.dimensions.a must not be empty')
  })
})

describe('parseSpec() — strategy validation', () => {
  it('rejects an unknown strategy value', () => {
    const raw = ['name: x', 'dimensions:', '  a: [x]', 'strategy: bogus'].join('\n')
    expect(expectErr(parseSpec(raw))).toBe('spec.strategy must be "pairwise" or "3-way"')
  })
})

describe('parseSpec() — constraints validation', () => {
  it('rejects constraints that are not an array', () => {
    const raw = ['name: x', 'dimensions:', '  a: [x]', 'constraints: nope'].join('\n')
    expect(expectErr(parseSpec(raw))).toBe('spec.constraints must be an array')
  })

  it('rejects a constraint that is not an object', () => {
    const raw = ['name: x', 'dimensions:', '  a: [x]', 'constraints:', '  - just-a-string'].join('\n')
    expect(expectErr(parseSpec(raw))).toBe('each constraint must be an object')
  })

  it('rejects a constraint whose when is not an object', () => {
    const raw = [
      'name: x',
      'dimensions:',
      '  a: [x]',
      'constraints:',
      '  - when: notanobject',
      '    then: skip',
    ].join('\n')
    expect(expectErr(parseSpec(raw))).toBe('constraint.when must be an object')
  })

  it('rejects a constraint whose then is not "skip"', () => {
    const raw = [
      'name: x',
      'dimensions:',
      '  a: [x]',
      'constraints:',
      '  - when: { a: x }',
      '    then: keep',
    ].join('\n')
    expect(expectErr(parseSpec(raw))).toBe('constraint.then must be "skip"')
  })
})

describe('parseSpec() — tags validation', () => {
  it('rejects tags that are not an array', () => {
    const raw = ['name: x', 'dimensions:', '  a: [x]', 'tags: nope'].join('\n')
    expect(expectErr(parseSpec(raw))).toBe('spec.tags must be an array')
  })

  it('rejects a tags array containing a non-string entry', () => {
    const raw = ['name: x', 'dimensions:', '  a: [x]', 'tags:', '  - "@ok"', '  - k: v'].join('\n')
    expect(expectErr(parseSpec(raw))).toBe('spec.tags entries must be strings')
  })
})

describe('specHash()', () => {
  it('returns a 64-char lowercase hex SHA-256 digest', () => {
    const hash = specHash('name: x\ndimensions:\n  a: [y]\n')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic for identical input', () => {
    const raw = 'name: x\ndimensions:\n  a: [y]\n'
    expect(specHash(raw)).toBe(specHash(raw))
  })

  it('normalises CRLF line endings to LF before hashing', () => {
    const lf = 'name: x\ndimensions:\n  a: [y]'
    const crlf = 'name: x\r\ndimensions:\r\n  a: [y]'
    expect(specHash(crlf)).toBe(specHash(lf))
  })

  it('strips trailing per-line whitespace before hashing', () => {
    const clean = 'name: x\ndimensions:'
    const trailing = 'name: x  \ndimensions:\t'
    expect(specHash(trailing)).toBe(specHash(clean))
  })

  it('ignores trailing document whitespace (trimEnd)', () => {
    const base = 'name: x'
    expect(specHash(base + '\n\n  ')).toBe(specHash(base))
  })

  it('produces different hashes for materially different content', () => {
    expect(specHash('name: a')).not.toBe(specHash('name: b'))
  })
})
