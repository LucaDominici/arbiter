/**
 * Gauntlet emitter tests (#1022).
 *
 * Covers the empty-constraint-matrix guard added to java.ts and rust.ts.
 */
import { describe, it, expect } from 'vitest'
import { emitJava } from '../../src/gauntlet/emitters/java.js'
import { emitRust } from '../../src/gauntlet/emitters/rust.js'
import { emitTypeScript } from '../../src/gauntlet/emitters/typescript.js'
import type { GauntletSpec } from '../../src/gauntlet/spec.js'
import type { IpogRow } from '../../src/gauntlet/ipog.js'

const SPEC: GauntletSpec = {
  name: 'my-test',
  strategy: 'pairwise',
  tags: [],
  dimensions: { env: ['dev', 'prod'], region: ['us', 'eu'] },
  constraints: [],
}

const ROWS: IpogRow[] = [
  { env: 'dev', region: 'us' },
  { env: 'prod', region: 'eu' },
]

describe('emitJava (#1022)', () => {
  it('throws when rows is empty', () => {
    expect(() => emitJava(SPEC, [])).toThrow(
      /no rows match constraints — cannot emit empty test suite/,
    )
  })

  it('emits a valid Java class for non-empty rows', () => {
    const out = emitJava(SPEC, ROWS)
    expect(out).toContain('MyTestGauntletTest')
    expect(out).toContain('@ParameterizedTest')
    expect(out).toContain('Arguments.of')
  })

  it('includes all param values in the output', () => {
    const out = emitJava(SPEC, ROWS)
    expect(out).toContain('"dev"')
    expect(out).toContain('"prod"')
    expect(out).toContain('"us"')
    expect(out).toContain('"eu"')
  })

  it('includes the row count in the header comment', () => {
    const out = emitJava(SPEC, ROWS)
    expect(out).toContain(`rows: ${ROWS.length}`)
  })
})

describe('emitRust (#1022)', () => {
  it('throws when rows is empty', () => {
    expect(() => emitRust(SPEC, [])).toThrow(
      /no rows match constraints — cannot emit empty test suite/,
    )
  })

  it('emits a valid Rust test module for non-empty rows', () => {
    const out = emitRust(SPEC, ROWS)
    expect(out).toContain('#[rstest]')
    expect(out).toContain('#[case(')
    expect(out).toContain('mod my_test_gauntlet')
  })

  it('includes all param values in the output', () => {
    const out = emitRust(SPEC, ROWS)
    expect(out).toContain('"dev"')
    expect(out).toContain('"us"')
  })

  it('includes the row count in the header comment', () => {
    const out = emitRust(SPEC, ROWS)
    expect(out).toContain(`rows: ${ROWS.length}`)
  })
})

// ── Adversarial-input escaping & identifier sanitization (#1590) ──────────────

const ADVERSARIAL: GauntletSpec = {
  // apostrophe, space → must not break TS single-quote / produce invalid idents
  name: "trip's form",
  strategy: 'pairwise',
  // backtick + ${...} → must not become a live template-literal interpolation
  tags: ['`@evil${process.env}`'],
  // `match` is a Rust reserved keyword; values carry a quote and a backslash
  dimensions: { match: ['a"b', 'c\\d'], region: ['us'] },
  constraints: [],
}

const ADV_ROWS: IpogRow[] = [
  { match: 'a"b', region: 'us' },
  { match: 'c\\d', region: 'us' },
]

describe('emitTypeScript — adversarial escaping (#1590)', () => {
  const out = emitTypeScript(ADVERSARIAL, ADV_ROWS)

  it('uses JSON.stringify for the describe name (no raw single-quote splice)', () => {
    expect(out).not.toContain("test.describe('")
    expect(out).toContain(`test.describe(${JSON.stringify(ADVERSARIAL.name)},`)
  })

  it('builds the tag label as a string literal, not a live interpolation', () => {
    // The tag must be JSON-encoded and concatenated — never spliced raw into a
    // backtick template where ${process.env} would execute at test runtime.
    const safeTag = JSON.stringify('[' + ADVERSARIAL.tags[0] + '] ')
    expect(out).toContain(`test(${safeTag} + label,`)
    expect(out).not.toContain('`[`@evil')
  })
})

describe('emitJava — adversarial escaping (#1590)', () => {
  const out = emitJava(ADVERSARIAL, ADV_ROWS)

  it('produces a valid Java class identifier', () => {
    const m = out.match(/public class (\S+) \{/)
    expect(m).not.toBeNull()
    expect(m![1]).toMatch(/^[A-Za-z_$][A-Za-z0-9_$]*$/)
  })

  it('escapes quote and backslash inside string literals', () => {
    expect(out).toContain('"a\\"b"')
    expect(out).toContain('"c\\\\d"')
  })

  it('produces a valid Java method identifier', () => {
    const m = out.match(/void (\w+)\(/)
    expect(m).not.toBeNull()
    expect(m![1]).toMatch(/^[A-Za-z_$][A-Za-z0-9_$]*$/)
  })
})

describe('emitRust — adversarial escaping (#1590)', () => {
  const out = emitRust(ADVERSARIAL, ADV_ROWS)

  it('produces a valid Rust module identifier (no apostrophe)', () => {
    const m = out.match(/mod (\w+) \{/)
    expect(m).not.toBeNull()
    expect(m![1]).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/)
  })

  it('escapes quote and backslash inside string literals', () => {
    expect(out).toContain('"a\\"b"')
    expect(out).toContain('"c\\\\d"')
  })

  it('renames the reserved keyword `match` to a non-keyword param identifier', () => {
    expect(out).not.toMatch(/\bmatch: &str\b/)
    expect(out).toContain('match_: &str')
  })
})
