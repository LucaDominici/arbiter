// SPDX-License-Identifier: Apache-2.0
/**
 * Regression tests for the gauntlet minimal-YAML parser's comment stripping
 * (#1528). A `#` only begins a YAML comment when it is at string start or
 * preceded by whitespace AND is not inside a quoted scalar. The previous
 * quote-unaware `.replace(/#.*$/, '')` silently corrupted any scalar value
 * containing `#` (issue refs like `#260`, hex like `#fff`, `bug#hot`).
 */
import { describe, it, expect } from 'vitest'
import { load as loadYaml } from 'js-yaml'
import { parseSpec, parseMinimalYaml } from '../../src/gauntlet/spec.js'
import type { ParseSpecResult, GauntletSpec } from '../../src/gauntlet/spec.js'

function expectOk(res: ParseSpecResult): GauntletSpec {
  expect(res.ok).toBe(true)
  if (!res.ok) throw new Error(`expected ok result, got: ${res.reason}`)
  return res.spec
}

describe('parseSpec comment stripping (#1528)', () => {
  it('preserves a leading "#" inside a quoted block-map value', () => {
    const spec = expectOk(parseSpec(`name: "#260"\ndimensions:\n  transport: [car, train]\n`))
    expect(spec.name).toBe('#260')
  })

  it('preserves a "#" in the middle of an unquoted scalar value', () => {
    const spec = expectOk(parseSpec(`name: bug#hot\ndimensions:\n  transport: [car, train]\n`))
    expect(spec.name).toBe('bug#hot')
  })

  it('still strips a genuine trailing comment (whitespace-preceded "#")', () => {
    const spec = expectOk(
      parseSpec(`name: trip # the run name\ndimensions:\n  transport: [car, train]\n`),
    )
    expect(spec.name).toBe('trip')
  })

  it('strips a trailing comment but keeps a "#" inside the quoted value', () => {
    const spec = expectOk(
      parseSpec(`name: "#260" # an issue ref\ndimensions:\n  transport: [car, train]\n`),
    )
    expect(spec.name).toBe('#260')
  })

  it('preserves "#"-bearing values in block-sequence (tags) items', () => {
    const spec = expectOk(
      parseSpec(
        `name: t\ndimensions:\n  transport: [car, train]\ntags:\n  - "#gauntlet"\n  - real#tag\n`,
      ),
    )
    expect(spec.tags).toEqual(['#gauntlet', 'real#tag'])
  })
})

/**
 * Differential + fail-closed regression tests (#1554). The bespoke parser drives
 * the gauntlet IPOG matrix expansion and the specHash gate, so a SILENT
 * divergence from real YAML changes which cells run with no oracle. The contract
 * is: for any document, the parser must either reproduce js-yaml's structure
 * EXACTLY or reject the input outright — never accept-and-diverge. js-yaml
 * (already a declared dependency) is the oracle.
 */
describe('parseMinimalYaml fail-closed vs js-yaml (#1554)', () => {
  /** Parse with our parser, reporting throw vs value. */
  function ours(doc: string): { threw: boolean; value?: unknown } {
    try {
      return { threw: false, value: parseMinimalYaml(doc) }
    } catch {
      return { threw: true }
    }
  }

  /** Parse with the js-yaml oracle, reporting throw vs value. */
  function oracle(doc: string): { threw: boolean; value?: unknown } {
    try {
      return { threw: false, value: loadYaml(doc) }
    } catch {
      return { threw: true }
    }
  }

  /**
   * The core invariant: our parser never silently over-accepts. If js-yaml
   * rejects a doc, we must reject it too; if both accept, the structures must be
   * deep-equal. (Our parser is allowed to reject more than js-yaml — explicit
   * rejection is always safe.)
   */
  function assertNoSilentDivergence(doc: string): void {
    const a = ours(doc)
    const b = oracle(doc)
    if (a.threw) return // explicit rejection is always acceptable
    // We accepted — js-yaml must have accepted too, with the SAME structure.
    expect(b.threw, `we accepted a doc js-yaml rejects:\n${doc}`).toBe(false)
    expect(a.value, `structural divergence from js-yaml:\n${doc}`).toEqual(b.value)
  }

  // ── The four bug classes from #1554, each must now be REJECTED (js-yaml errors) ─
  it('rejects an over-indented mapping sibling (was: silently dropped)', () => {
    const doc = 'name: t\ndimensions:\n  colors:\n    - red\n    - green\n    notadash: y\n'
    expect(ours(doc).threw).toBe(true)
    expect(oracle(doc).threw).toBe(true)
  })

  it('rejects a duplicate mapping key (was: silent last-wins)', () => {
    const doc = 'name: a\nname: b\n'
    expect(ours(doc).threw).toBe(true)
    expect(oracle(doc).threw).toBe(true)
  })

  it('rejects a duplicate key inside a flow map', () => {
    const doc =
      'name: t\ndimensions:\n  a: [x]\nconstraints:\n  - when: { a: x, a: y }\n    then: skip\n'
    expect(ours(doc).threw).toBe(true)
  })

  it('rejects leading-tab indentation (was: counted as one column)', () => {
    const doc = 'name: x\n\tdimensions: y\n'
    expect(ours(doc).threw).toBe(true)
    expect(oracle(doc).threw).toBe(true)
  })

  // ── The flow-splitting corruption: embedded commas / nested brackets ──────────
  it('preserves a quoted comma inside a flow sequence (was: split into 3 values)', () => {
    const doc = 'name: t\ndimensions:\n  region: ["us,east", "eu"]\n'
    // js-yaml is the oracle: the dimension has exactly two members.
    assertNoSilentDivergence(doc)
    const spec = expectOk(parseSpec(doc))
    expect(spec.dimensions['region']).toEqual(['us,east', 'eu'])
  })

  it('does not truncate a flow sequence at the first inner bracket', () => {
    const doc = 'name: t\ndimensions:\n  a: ["x]y", "z"]\n'
    assertNoSilentDivergence(doc)
    const spec = expectOk(parseSpec(doc))
    expect(spec.dimensions['a']).toEqual(['x]y', 'z'])
  })

  it('rejects an unbalanced flow sequence rather than guessing', () => {
    const doc = 'name: t\ndimensions:\n  a: [x, y\n'
    expect(ours(doc).threw).toBe(true)
  })

  // ── A deterministic corpus of well-formed docs: structures must match exactly ─
  it('matches js-yaml structurally across a corpus of valid documents', () => {
    const corpus = [
      'name: trip\ndimensions:\n  transport: [car, train, plane]\n  duration: [1d, 3d]\n',
      'name: q\ndimensions:\n  os: ["linux", "mac", "win"]\n',
      'name: hashy\ndimensions:\n  v: ["#260", "bug#hot"]\n',
      'name: nested\ndimensions:\n  region: ["us,east", "eu,west", "apac"]\n',
      'name: single\ndimensions:\n  k: [only]\n',
    ]
    for (const doc of corpus) assertNoSilentDivergence(doc)
  })
})
