/**
 * Gauntlet emitter tests (#1022).
 *
 * Covers the empty-constraint-matrix guard added to java.ts and rust.ts.
 */
import { describe, it, expect } from 'vitest'
import { emitJava } from '../../src/gauntlet/emitters/java.js'
import { emitRust } from '../../src/gauntlet/emitters/rust.js'
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
