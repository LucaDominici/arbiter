// SPDX-License-Identifier: Apache-2.0
// Unit tests for #1209: decideClearStrategy + buildHandoffBanner
import { describe, it, expect } from 'vitest'
import { decideClearStrategy, buildHandoffBanner } from '../../src/commands/task.js'

describe('decideClearStrategy (#1209)', () => {
  it('returns inline when modelSwitch=false regardless of units (CI path)', () => {
    expect(decideClearStrategy({ units: 100, modelSwitch: false })).toBe('inline')
    expect(decideClearStrategy({ units: undefined, modelSwitch: false })).toBe('inline')
  })

  it('returns inline for small unit count (units <= INLINE_MAX)', () => {
    expect(decideClearStrategy({ units: 5, modelSwitch: true })).toBe('inline')
    expect(decideClearStrategy({ units: 10, modelSwitch: true })).toBe('inline')
  })

  it('returns sub-agent for medium unit count (INLINE_MAX < units <= SUBAGENT_MAX)', () => {
    // INLINE_MAX=10, SUBAGENT_MAX=20 — 15 is firmly in the sub-agent band
    expect(decideClearStrategy({ units: 15, modelSwitch: true })).toBe('sub-agent')
    expect(decideClearStrategy({ units: 20, modelSwitch: true })).toBe('sub-agent')
  })

  it('returns stop for large unit count (units > SUBAGENT_MAX)', () => {
    expect(decideClearStrategy({ units: 999, modelSwitch: true })).toBe('stop')
    expect(decideClearStrategy({ units: 21, modelSwitch: true })).toBe('stop')
  })

  it('returns stop when units absent + modelSwitch=true (backward-compat: existing tests must not break)', () => {
    // All existing handoff gate tests pass no units — must preserve throw behavior (stop → throw)
    expect(decideClearStrategy({ units: undefined, modelSwitch: true })).toBe('stop')
  })
})

describe('buildHandoffBanner (#1209)', () => {
  it('contains task id in the banner', () => {
    const banner = buildHandoffBanner({
      taskId: '#703',
      strategy: 'stop',
      units: undefined,
      tier: undefined,
    })
    expect(banner).toContain('#703')
  })

  it('contains --post-clear flag in the banner', () => {
    const banner = buildHandoffBanner({
      taskId: '#703',
      strategy: 'stop',
      units: undefined,
      tier: undefined,
    })
    expect(banner).toContain('--post-clear')
  })

  it('contains strategy name in the banner', () => {
    const stopBanner = buildHandoffBanner({
      taskId: '#703',
      strategy: 'stop',
      units: undefined,
      tier: undefined,
    })
    expect(stopBanner).toMatch(/stop/i)

    const subBanner = buildHandoffBanner({
      taskId: '#703',
      strategy: 'sub-agent',
      units: 12,
      tier: 'S',
    })
    expect(subBanner).toMatch(/sub.?agent/i)
  })

  it('is a multi-line substantial string (not a terse one-liner)', () => {
    const banner = buildHandoffBanner({
      taskId: '#703',
      strategy: 'stop',
      units: undefined,
      tier: undefined,
    })
    expect(banner.length).toBeGreaterThan(80)
    expect(banner).toContain('\n')
  })
})
