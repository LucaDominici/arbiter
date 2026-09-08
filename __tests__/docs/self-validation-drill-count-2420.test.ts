// SPDX-License-Identifier: Apache-2.0
// #2420 AC-2: TESTING.md §Self-Validation claimed the A/B/C drill proves "each gate"
// honours the exit contract, and §Staged Rollout promised "Full 18-gate coverage" — a
// number sourced from nothing. scripts/self-validation.mjs registers 2 gates. The AC
// permits either registering the 18 gates or stating the real count; the doc route is
// taken, so these assertions pin the stated count to the drill's actual GATES array
// (in the live script AND its template twin) so the two cannot drift apart again.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string): string => readFileSync(resolve(p), 'utf8')

const testing = read('docs/internal/METHOD/TESTING.md')
const drill = read('scripts/self-validation.mjs')
const drillTemplate = read('src/templates/scripts/self-validation.mjs.ejs')

/** Count the entries of the drill's `GATES` array by their `id:` keys. */
function registeredGateCount(source: string): number {
  const start = source.indexOf('const GATES = [')
  expect(start).toBeGreaterThan(-1)
  const end = source.indexOf('\n]', start)
  expect(end).toBeGreaterThan(start)
  const body = source.slice(start, end)
  return [...body.matchAll(/^\s{4}id:\s*['"][^'"]+['"],$/gm)].length
}

/** The count TESTING.md states for the drill's registered coverage. */
function statedCount(doc: string): number {
  const m = /\*\*Registered coverage: (\d+) gates?\*\*/.exec(doc)
  expect(m, 'TESTING.md must state the drill’s registered gate count').not.toBeNull()
  return Number((m as RegExpExecArray)[1])
}

describe('#2420 AC-2 — the A/B/C drill coverage claim matches the drill', () => {
  it('scripts/self-validation.mjs and its template twin register the same gate count', () => {
    expect(registeredGateCount(drill)).toBe(registeredGateCount(drillTemplate))
  })

  it('TESTING.md states the drill’s real registered gate count', () => {
    expect(statedCount(testing)).toBe(registeredGateCount(drill))
  })

  it('TESTING.md no longer promises the unsourced "18-gate" coverage', () => {
    expect(testing).not.toContain('18-gate')
  })

  it('TESTING.md does not claim the drill proves every enforcement script', () => {
    // The contract binds every enforcement script; the DRILL only proves the
    // registered ones. The doc must not conflate the two.
    expect(testing).not.toContain('The A/B/C drill proves each gate honors this contract')
  })
})
