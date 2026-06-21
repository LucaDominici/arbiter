// SPDX-License-Identifier: Apache-2.0
/**
 * Edge-branch coverage tests for src/gauntlet/spec.ts (#1486 branch-coverage climb).
 *
 * The companion suite `spec.cov.test.ts` already exercises the common validation
 * branches and the mainstream YAML shapes. This suite targets the REMAINING
 * uncovered branches of the bespoke minimal-YAML parser — the rarely-walked
 * corners of `parseBlock`, `parseBlockSeq`, `parseBlockMap`,
 * `parseSubKeysAfterDash`, `findMappingColon`, `parseFlowMap`, and the scalar
 * helpers:
 *
 *   - tab-delimited mapping colons (`key:\tvalue`)
 *   - double-quoted mapping keys routed through `findMappingColon`
 *   - block-map lines whose colon is not a real separator (no value, break)
 *   - the `~`/`null` scalar sentinels
 *   - empty (`-`) dash items with an indented sub-block, including a dedented
 *     sub-block that under-runs the expected indent
 *   - inline-flow `when` values given as a sequence (`- when: [a, b]`)
 *   - inline-flow `{ ... }` dash items both with and without trailing sub-keys
 *   - empty-key entries inside an inline flow map (`{ : v, a: x }`)
 *   - `parseSubKeysAfterDash` returning null on a dedent and on a non-key line
 *   - a stray top-level dash after a mapping
 *
 * The module is pure (no filesystem, network, or clock), so every assertion is
 * fully deterministic. This file does not touch — and never edits —
 * `spec.cov.test.ts`; the small narrowing helpers below are re-declared locally
 * so the two suites stay independent.
 */

import { describe, it, expect } from 'vitest'
import { parseSpec } from '../../src/gauntlet/spec.js'
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

describe('parseSpec() — mapping-colon edge cases (findMappingColon branches)', () => {
  it('accepts a tab between the mapping key and its value', () => {
    // `name:\tx` forces findMappingColon to accept a TAB (not just a space)
    // as the post-colon delimiter (the `s[i + 1] === '\t'` branch).
    const raw: string = ['name:\tx', 'dimensions:', '  a: [y]'].join('\n')
    const spec: GauntletSpec = expectOk(parseSpec(raw))
    expect(spec.name).toBe('x')
    expect(spec.dimensions).toEqual({ a: ['y'] })
  })

  it('parses a double-quoted mapping key (drives the in-double-quote scan)', () => {
    // The `"a"` key exercises the `c === '"' && !inSingle` toggle in
    // findMappingColon, which the single-quoted-key sibling does not.
    const raw: string = ['name: dq', 'dimensions:', '  "a": [x, y]'].join('\n')
    const spec: GauntletSpec = expectOk(parseSpec(raw))
    expect(spec.dimensions).toEqual({ a: ['x', 'y'] })
  })

  it('breaks the block map on a key-like line whose colon has no trailing space', () => {
    // `weird:value` matches the block-map entry regex, so the line enters
    // parseBlockMap, but findMappingColon returns -1 (colon not followed by a
    // space/tab/EOL) → the `colonIdx < 0` break fires and the line is ignored.
    const raw: string = ['name: cn', 'dimensions:', '  a: [x]', 'weird:value'].join('\n')
    const spec: GauntletSpec = expectOk(parseSpec(raw))
    expect(spec.name).toBe('cn')
    expect(spec.dimensions).toEqual({ a: ['x'] })
  })
})

describe('parseSpec() — scalar sentinels and nested-block values', () => {
  it('treats a `~` strategy value as null and falls back to the pairwise default', () => {
    // `~` is a YAML null sentinel → parseScalar returns null → the
    // `strategyRaw ?? 'pairwise'` default path is taken.
    const raw: string = ['name: tilde', 'dimensions:', '  a: [x]', 'strategy: ~'].join('\n')
    const spec: GauntletSpec = expectOk(parseSpec(raw))
    expect(spec.strategy).toBe('pairwise')
  })

  it('parses a scalar-looking key whose value is actually an indented child block', () => {
    // `meta: header` then a MORE-indented `owner:` line drives the
    // `nextIndent > indent` branch of parseBlockMap (value becomes a child
    // block rather than the inline scalar). `meta` is ignored by the validator;
    // the point is the nested-block branch executes without error.
    const raw: string = [
      'name: childblock',
      'dimensions:',
      '  a: [x]',
      'meta: header',
      '  owner: alice',
    ].join('\n')
    const spec: GauntletSpec = expectOk(parseSpec(raw))
    expect(spec.name).toBe('childblock')
    expect(spec.dimensions).toEqual({ a: ['x'] })
  })
})

describe('parseSpec() — empty-dash items and their sub-blocks', () => {
  it('parses an empty `-` dash whose constraint body is an indented sub-block', () => {
    // `  -` with nothing after it is the `rest === ''` multi-line-item branch;
    // the indented `when:`/`then:` lines become the dash payload via
    // parseBlock(ctx, indent + 2).
    const raw: string = [
      'name: emptydash',
      'dimensions:',
      '  a: [x]',
      'constraints:',
      '  -',
      '    when: { a: x }',
      '    then: skip',
    ].join('\n')
    const spec: GauntletSpec = expectOk(parseSpec(raw))
    expect(spec.constraints).toEqual([{ when: { a: 'x' }, then: 'skip' }])
  })

  it('returns a null dash payload when the sub-block under-runs the expected indent', () => {
    // `  -` expects its sub-block at indent 4 (indent + 2), but the following
    // `when:` line sits at indent 3 → parseBlock hits `lineIndent < indent` and
    // returns null → the dash item is null → "each constraint must be an object".
    const raw: string = [
      'name: dedentdash',
      'dimensions:',
      '  a: [x]',
      'constraints:',
      '  -',
      '   when: { a: x }',
    ].join('\n')
    expect(expectErr(parseSpec(raw))).toBe('each constraint must be an object')
  })
})

describe('parseSpec() — inline-flow dash items', () => {
  it('parses a `- when: [..]` whose value is an inline flow sequence', () => {
    // The `- key: value` inline branch routes the value through
    // parseScalarOrFlow, and `[a, b]` takes its `s.startsWith('[')` arm,
    // yielding an array `when`. An array is `typeof 'object'`, so the validator
    // accepts it and the constraint is built with the array as its `when`.
    const raw: string = [
      'name: flowseqwhen',
      'dimensions:',
      '  a: [x]',
      'constraints:',
      '  - when: [a, b]',
      '    then: skip',
    ].join('\n')
    const spec: GauntletSpec = expectOk(parseSpec(raw))
    expect(spec.constraints).toEqual([{ when: ['a', 'b'], then: 'skip' }])
  })

  it('parses a bare `- { ... }` flow-map dash with NO trailing sub-keys', () => {
    // `- { when: x, then: skip }` is the `rest.startsWith('{')` branch; with no
    // indented sub-keys following, parseSubKeysAfterDash returns null and the
    // dash item is the flow map alone (the `sub === null` else arm).
    // `when: x` is a string here, so the validator rejects it.
    const raw: string = [
      'name: bareflowmap',
      'dimensions:',
      '  a: [x]',
      'constraints:',
      '  - { when: x, then: skip }',
    ].join('\n')
    expect(expectErr(parseSpec(raw))).toBe('constraint.when must be an object')
  })

  it('merges a `- { ... }` flow-map dash with trailing indented sub-keys', () => {
    // Same `{ ... }` dash branch, but this time indented `when:`/`then:` lines
    // follow, so parseSubKeysAfterDash returns a map and the two objects are
    // spread-merged (the `sub !== null` arm). The flat flow map (`{ foo: bar }`)
    // contributes an extra key; the indented sub-keys supply the real
    // when/then that the validator consumes.
    const raw: string = [
      'name: flowmapmerge',
      'dimensions:',
      '  a: [x]',
      'constraints:',
      '  - { foo: bar }',
      '    when: { a: x }',
      '    then: skip',
    ].join('\n')
    const spec: GauntletSpec = expectOk(parseSpec(raw))
    expect(spec.constraints).toEqual([{ when: { a: 'x' }, then: 'skip' }])
  })

  it('drops an empty-key entry inside an inline flow map (`{ : v, a: x }`)', () => {
    // The leading `: v` pair has an empty key once trimmed, so the
    // `if (k !== '')` guard in parseFlowMap skips it; only `a: x` survives.
    const raw: string = [
      'name: emptyflowkey',
      'dimensions:',
      '  a: [x]',
      'constraints:',
      '  - when: { : v, a: x }',
      '    then: skip',
    ].join('\n')
    const spec: GauntletSpec = expectOk(parseSpec(raw))
    expect(spec.constraints).toEqual([{ when: { a: 'x' }, then: 'skip' }])
  })
})

describe('parseSpec() — parseSubKeysAfterDash null paths', () => {
  it('stops collecting sub-keys when the next line dedents below the dash body', () => {
    // After `  - when: { a: x }`, the next `  - when: { a: y }` sits at indent 2,
    // below the expected sub-key indent 4 → parseSubKeysAfterDash hits
    // `lineIndent < indent` and returns null, so the first dash has no `then`
    // and the SECOND dash supplies the (mismatched) `then` → validation error.
    const raw: string = [
      'name: subdedent',
      'dimensions:',
      '  a: [x]',
      'constraints:',
      '  - when: { a: x }',
      '  - when: { a: y }',
      '    then: skip',
    ].join('\n')
    expect(expectErr(parseSpec(raw))).toBe('constraint.then must be "skip"')
  })

  it('returns null from parseSubKeysAfterDash on a sub-line that is not a mapping key', () => {
    // The line following the dash is at the right indent but is a flow scalar
    // `[notakey]`, which fails the key regex in parseSubKeysAfterDash → it
    // returns null, leaving the dash without a `then`.
    const raw: string = [
      'name: subnonkey',
      'dimensions:',
      '  a: [x]',
      'constraints:',
      '  - when: { a: x }',
      '    [notakey]',
    ].join('\n')
    expect(expectErr(parseSpec(raw))).toBe('constraint.then must be "skip"')
  })
})

describe('parseSpec() — block-map / block-seq boundary breaks', () => {
  it('breaks the top-level block map on a stray dash line and ignores it', () => {
    // A `- stray` line at column 0 inside the top-level mapping fires the
    // `trimmed.startsWith('-')` break in parseBlockMap; parsing stops cleanly
    // and the already-collected name/dimensions remain valid.
    const raw: string = ['name: straydash', 'dimensions:', '  a: [x]', '- stray'].join('\n')
    const spec: GauntletSpec = expectOk(parseSpec(raw))
    expect(spec.name).toBe('straydash')
    expect(spec.dimensions).toEqual({ a: ['x'] })
  })

  it('breaks a block sequence on a same-indent non-dash sibling line', () => {
    // Under `colors:`, two dash items then a same-indent `notadash:` line that
    // does not start with `-` triggers the `!trimmed.startsWith('-')` break in
    // parseBlockSeq, terminating the sequence at two elements.
    const raw: string = [
      'name: seqbreak',
      'dimensions:',
      '  colors:',
      '    - red',
      '    - green',
      '    notadash: y',
    ].join('\n')
    const spec: GauntletSpec = expectOk(parseSpec(raw))
    expect(spec.dimensions).toEqual({ colors: ['red', 'green'] })
  })
})
