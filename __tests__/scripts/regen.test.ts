// SPDX-License-Identifier: Apache-2.0
// TDD guard for scripts/regen.mjs (`npm run regen`, gate-throughput follow-up):
// buildPlan() must run `npm run build` first (kills the dist-staleness class,
// #2089), then every DERIVED_ARTIFACTS writeCmd in order, so the gate's
// derived-artifact checks never fail on stale generated state again.
import { describe, it, expect } from 'vitest'
import { buildPlan } from '../../scripts/regen.mjs'
import { DERIVED_ARTIFACTS } from '../../scripts/lib/derived-artifacts.mjs'

describe('scripts/regen.mjs buildPlan()', () => {
  it('runs `npm run build` first', () => {
    const plan = buildPlan(DERIVED_ARTIFACTS)
    expect(plan[0]).toEqual({ name: 'build', cmd: 'npm', args: ['run', 'build'] })
  })

  it('runs every artifact writeCmd exactly once after the build step', () => {
    const plan = buildPlan(DERIVED_ARTIFACTS)
    expect(plan.length).toBe(DERIVED_ARTIFACTS.length + 1)
    for (const a of DERIVED_ARTIFACTS) {
      const step = plan.find((s) => s.name === a.name)
      expect(step?.cmd).toBe(a.writeCmd[0])
      expect(step?.args).toEqual(a.writeCmd.slice(1))
    }
  })

  // #2568: generators that CONSUME documents (wiki, doc index, llms.txt) ran before the
  // generators that PRODUCE them (status, gap, adr digest, feature matrix), so one regen left
  // the wiki stale against its own sources and only a second run converged.
  it('#2568 — orders phases produce → index → consume regardless of registry order', () => {
    const fake = [
      { name: 'c', phase: 'consume', checkCmd: ['node', 'c.mjs'], writeCmd: ['node', 'c.mjs'] },
      { name: 'i', phase: 'index', checkCmd: ['node', 'i.mjs'], writeCmd: ['node', 'i.mjs'] },
      { name: 'p2', phase: 'produce', checkCmd: ['node', 'p.mjs'], writeCmd: ['node', 'p2.mjs'] },
      { name: 'p1', phase: 'produce', checkCmd: ['node', 'p.mjs'], writeCmd: ['node', 'p1.mjs'] },
    ]
    expect(buildPlan(fake).map((s) => s.name)).toEqual(['build', 'p2', 'p1', 'i', 'c'])
  })

  it('#2568 — an entry with no declared phase (or an unknown one) is refused, not silently appended', () => {
    const none = [{ name: 'x', checkCmd: ['node', 'x.mjs'], writeCmd: ['node', 'x.mjs'] }]
    expect(() => buildPlan(none)).toThrow(/phase/)
    const bad = [
      { name: 'x', phase: 'later', checkCmd: ['node', 'x.mjs'], writeCmd: ['node', 'x.mjs'] },
    ]
    expect(() => buildPlan(bad)).toThrow(/phase/)
  })

  it('#2568 — in the real registry every doc consumer runs after every doc producer', () => {
    const names = buildPlan(DERIVED_ARTIFACTS).map((s) => s.name)
    const at = (n: string) => names.indexOf(n)
    const producers = [
      'status dashboard',
      'gap register',
      'adr digest (INV-107)',
      'feature matrix (INV-112)',
      'derived pages (#1838)',
    ]
    const consumers = ['wiki lint (INV-116)', 'doc index (#1102)', 'llms.txt drift (#1721)']
    for (const p of producers)
      for (const c of consumers) expect(at(p), `${p} before ${c}`).toBeLessThan(at(c))
    expect(at('ssot core index (#1100)')).toBeLessThan(at('wiki lint (INV-116)'))
    expect(at('doc index (#1102)')).toBeLessThan(at('wiki lint (INV-116)'))
  })

  it('is a pure function of its argument (no hidden global state)', () => {
    const fake = [
      {
        name: 'fake',
        phase: 'produce',
        checkCmd: ['node', 'x.mjs'],
        writeCmd: ['node', 'y.mjs', '--z'],
      },
    ]
    const plan = buildPlan(fake)
    expect(plan).toEqual([
      { name: 'build', cmd: 'npm', args: ['run', 'build'] },
      { name: 'fake', cmd: 'node', args: ['y.mjs', '--z'] },
    ])
  })
})
