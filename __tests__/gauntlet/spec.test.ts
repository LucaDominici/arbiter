// SPDX-License-Identifier: Apache-2.0
/**
 * Regression tests for the gauntlet minimal-YAML parser's comment stripping
 * (#1528). A `#` only begins a YAML comment when it is at string start or
 * preceded by whitespace AND is not inside a quoted scalar. The previous
 * quote-unaware `.replace(/#.*$/, '')` silently corrupted any scalar value
 * containing `#` (issue refs like `#260`, hex like `#fff`, `bug#hot`).
 */
import { describe, it, expect } from 'vitest'
import { parseSpec } from '../../src/gauntlet/spec.js'
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
