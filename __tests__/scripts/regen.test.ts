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

  it('runs every artifact writeCmd, in order, after the build step', () => {
    const plan = buildPlan(DERIVED_ARTIFACTS)
    expect(plan.length).toBe(DERIVED_ARTIFACTS.length + 1)
    DERIVED_ARTIFACTS.forEach((a, i) => {
      const step = plan[i + 1]
      expect(step.name).toBe(a.name)
      expect(step.cmd).toBe(a.writeCmd[0])
      expect(step.args).toEqual(a.writeCmd.slice(1))
    })
  })

  it('is a pure function of its argument (no hidden global state)', () => {
    const fake = [{ name: 'fake', checkCmd: ['node', 'x.mjs'], writeCmd: ['node', 'y.mjs', '--z'] }]
    const plan = buildPlan(fake)
    expect(plan).toEqual([
      { name: 'build', cmd: 'npm', args: ['run', 'build'] },
      { name: 'fake', cmd: 'node', args: ['y.mjs', '--z'] },
    ])
  })
})
