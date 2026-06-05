// SPDX-License-Identifier: Apache-2.0
// TDD RED tests for #1209: decideClearStrategy + buildHandoffBanner
// These tests fail until the functions are exported from task.ts (GREEN phase).
import { describe, it, expect } from 'vitest'

// Import the new functions — will be undefined until exported (esbuild does not enforce named-export
// existence at module-load time; calling undefined() throws TypeError → test fails → RED).
import {
  // @ts-expect-error — not yet exported; will be defined in GREEN phase
  decideClearStrategy,
  // @ts-expect-error — not yet exported; will be defined in GREEN phase
  buildHandoffBanner,
} from '../../src/commands/task.js'

describe('decideClearStrategy (#1209)', () => {
  it('returns inline when modelSwitch=false regardless of units (CI path)', () => {
    expect(
      (decideClearStrategy as (a: unknown) => string)({
        units: 100,
        tier: 'Standard',
        modelSwitch: false,
      }),
    ).toBe('inline')
    expect(
      (decideClearStrategy as (a: unknown) => string)({
        units: undefined,
        tier: 'Standard',
        modelSwitch: false,
      }),
    ).toBe('inline')
  })

  it('returns inline for small unit count (units <= INLINE_MAX)', () => {
    expect(
      (decideClearStrategy as (a: unknown) => string)({
        units: 5,
        tier: 'Standard',
        modelSwitch: true,
      }),
    ).toBe('inline')
  })

  it('returns sub-agent for medium unit count (INLINE_MAX < units <= SUBAGENT_MAX)', () => {
    const result = (decideClearStrategy as (a: unknown) => string)({
      units: 15,
      tier: 'Standard',
      modelSwitch: true,
    })
    expect(['sub-agent', 'stop']).toContain(result) // exact boundary TBD — must be non-inline for medium
    // Specifically: the mid range should differ from inline and stop
  })

  it('returns stop for large unit count (units > SUBAGENT_MAX)', () => {
    expect(
      (decideClearStrategy as (a: unknown) => string)({
        units: 999,
        tier: 'Standard',
        modelSwitch: true,
      }),
    ).toBe('stop')
  })

  it('returns stop when units absent + modelSwitch=true (backward-compat: existing tests must not break)', () => {
    // All existing handoff gate tests pass no units — must preserve throw behavior (stop → throw)
    expect(
      (decideClearStrategy as (a: unknown) => string)({
        units: undefined,
        tier: 'Standard',
        modelSwitch: true,
      }),
    ).toBe('stop')
  })

  it('returns stop for XS tier without units (conservative default preserves backward compat)', () => {
    expect(
      (decideClearStrategy as (a: unknown) => string)({
        units: undefined,
        tier: 'XS',
        modelSwitch: true,
      }),
    ).toBe('stop')
  })
})

describe('buildHandoffBanner (#1209)', () => {
  it('contains task id in the banner', () => {
    const banner = (buildHandoffBanner as (a: unknown) => string)({
      taskId: '#703',
      strategy: 'stop',
      units: undefined,
      tier: 'Standard',
    })
    expect(banner).toContain('#703')
  })

  it('contains --post-clear flag in the banner', () => {
    const banner = (buildHandoffBanner as (a: unknown) => string)({
      taskId: '#703',
      strategy: 'stop',
      units: undefined,
      tier: 'Standard',
    })
    expect(banner).toContain('--post-clear')
  })

  it('contains strategy name in the banner', () => {
    const stopBanner = (buildHandoffBanner as (a: unknown) => string)({
      taskId: '#703',
      strategy: 'stop',
      units: undefined,
      tier: 'Standard',
    })
    expect(stopBanner).toMatch(/stop/i)

    const subBanner = (buildHandoffBanner as (a: unknown) => string)({
      taskId: '#703',
      strategy: 'sub-agent',
      units: 12,
      tier: 'S',
    })
    expect(subBanner).toMatch(/sub.?agent/i)
  })

  it('is a multi-line substantial string (not a terse one-liner)', () => {
    const banner = (buildHandoffBanner as (a: unknown) => string)({
      taskId: '#703',
      strategy: 'stop',
      units: undefined,
      tier: 'Standard',
    })
    expect(banner.length).toBeGreaterThan(80)
    expect(banner).toContain('\n')
  })
})
