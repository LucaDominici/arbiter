// SPDX-License-Identifier: Apache-2.0
// A10 (#1817): frontend token-hygiene check — semantic-token-only styling, opt-in fe-kit
// check, with baseline + ratchet mechanics for grandfathered violations.
// Algorithm generalized from a reference project's scripts/verify-primitives-tokens.mjs (not copy-pasted).

import { describe, it, expect } from 'vitest'
import {
  scanTokenHygiene,
  applyBaseline,
  isTokenHygieneGatePass,
  type HygieneFile,
} from '../../../src/kit/checks/token-hygiene.js'

function file(path: string, content: string): HygieneFile {
  return { path, content }
}

describe('scanTokenHygiene — raw palette classes', () => {
  it('flags a raw Tailwind palette utility class', () => {
    const violations = scanTokenHygiene([file('Card.vue', '<div class="bg-red-500">hi</div>')])
    expect(violations).toContainEqual(
      expect.objectContaining({ file: 'Card.vue', rule: 'raw-palette' }),
    )
  })

  it('passes a semantic token class not in the raw-palette shape', () => {
    const violations = scanTokenHygiene([
      file('Card.vue', '<div class="bg-surface-muted">hi</div>'),
    ])
    expect(violations.filter((v) => v.rule === 'raw-palette')).toHaveLength(0)
  })

  it('passes an allow-listed semantic color name even with a numeric shade', () => {
    const violations = scanTokenHygiene([file('Card.vue', '<div class="bg-brand-500">hi</div>')], {
      allowedColorNames: ['brand'],
    })
    expect(violations.filter((v) => v.rule === 'raw-palette')).toHaveLength(0)
  })

  it('does not false-positive on non-color sized utilities', () => {
    const violations = scanTokenHygiene([
      file('Card.vue', '<div class="text-sm border-2 ring-1">hi</div>'),
    ])
    expect(violations.filter((v) => v.rule === 'raw-palette')).toHaveLength(0)
  })

  it('records the correct line number', () => {
    const violations = scanTokenHygiene([
      file('Card.vue', 'line one\n<div class="bg-blue-600">hi</div>\nline three'),
    ])
    expect(violations[0]?.line).toBe(2)
  })
})

describe('scanTokenHygiene — forbidden <style> blocks', () => {
  it('flags a <style> block when forbidStyleBlocks is set', () => {
    const violations = scanTokenHygiene(
      [file('Card.vue', '<template></template>\n<style>.x{color:red}</style>')],
      { forbidStyleBlocks: true },
    )
    expect(violations.some((v) => v.rule === 'style-block')).toBe(true)
  })

  it('does not flag <style> blocks by default', () => {
    const violations = scanTokenHygiene([
      file('Card.vue', '<template></template>\n<style>.x{color:red}</style>'),
    ])
    expect(violations.filter((v) => v.rule === 'style-block')).toHaveLength(0)
  })
})

describe('applyBaseline — grandfathering + ratchet', () => {
  it('tolerates a violation exactly matching a baseline entry', () => {
    const violations = scanTokenHygiene([file('Legacy.vue', '<div class="bg-red-500">hi</div>')])
    const { newViolations, tolerated } = applyBaseline(violations, {
      grandfathered: [{ file: 'Legacy.vue', line: 1, pattern: 'bg-red-500' }],
    })
    expect(newViolations).toHaveLength(0)
    expect(tolerated).toHaveLength(1)
  })

  it('treats a violation not in the baseline as new (ratchet blocks it)', () => {
    const violations = scanTokenHygiene([file('Fresh.vue', '<div class="bg-red-500">hi</div>')])
    const { newViolations } = applyBaseline(violations, {
      grandfathered: [{ file: 'Legacy.vue', line: 1, pattern: 'bg-red-500' }],
    })
    expect(newViolations).toHaveLength(1)
  })

  it('passes an empty baseline through unchanged', () => {
    const violations = scanTokenHygiene([file('Fresh.vue', '<div class="bg-red-500">hi</div>')])
    const { newViolations, tolerated } = applyBaseline(violations, { grandfathered: [] })
    expect(newViolations).toHaveLength(1)
    expect(tolerated).toHaveLength(0)
  })
})

describe('isTokenHygieneGatePass', () => {
  it('passes when there are no new violations', () => {
    expect(isTokenHygieneGatePass([])).toBe(true)
  })

  it('fails when at least one new violation remains', () => {
    expect(
      isTokenHygieneGatePass([
        { file: 'X.vue', line: 1, snippet: 'bg-red-500', rule: 'raw-palette' },
      ]),
    ).toBe(false)
  })
})
