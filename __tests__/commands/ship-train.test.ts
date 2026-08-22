// SPDX-License-Identifier: Apache-2.0
/**
 * #2331 — bounded sealed trains.
 *
 * A train accumulates issues onto ONE worktree/branch/gate/PR and must stop on an explicit,
 * deterministic rule. An unbounded batch is not a train, it is a long-lived branch — the exact
 * failure mode batching exists to avoid.
 *
 * Every signal consumed here is available BEFORE the appended issue has any diff, because that
 * is when the append decision happens.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendChainIds, evaluateSeal, DEFAULT_TRAIN_LIMITS } from '../../src/commands/ship-train'
import { runTaskShip } from '../../src/commands/task-ship'
import { readUnifiedState } from '../../src/commands/task-state'
import type { ShipProfile } from '../../src/commands/ship-profile'

const TEST_PROFILE: ShipProfile = {
  isArbiterSelf: false,
  collaborationMode: 'peer-review',
  mergeMode: 'pr-ff',
  governanceLevel: 'L2',
  autonomy: 'L0',
  maxParallelWorktrees: 1,
  defaultGateLevel: 'L1',
  affinityBatching: false,
  companions: [],
}

const at = (iso: string): Date => new Date(iso)
const OPENED = '2026-08-22T00:00:00.000Z'

const signals = (over: Partial<Parameters<typeof evaluateSeal>[0]> = {}) => ({
  chainSize: 0,
  openedAt: OPENED,
  now: at('2026-08-22T00:10:00.000Z'),
  widenedTier: 'S' as const,
  explicitSeal: false,
  ...over,
})

describe('appendChainIds (#2331)', () => {
  it('appends instead of replacing — the whole point of an accumulating train', () => {
    expect(appendChainIds(['#2'], ['#3'])).toEqual(['#2', '#3'])
  })

  it('normalizes bare numbers to canonical #NNN', () => {
    expect(appendChainIds([], ['7', '#8'])).toEqual(['#7', '#8'])
  })

  it('dedupes against what is already on the train, preserving order', () => {
    expect(appendChainIds(['#2', '#3'], ['3', '#4', '2'])).toEqual(['#2', '#3', '#4'])
  })

  it('rejects a non-numeric id rather than letting it reach the pre-push commit scan', () => {
    expect(() => appendChainIds([], ['not-an-issue'])).toThrow(/Invalid chain id/)
  })

  it('is a no-op for an empty addition list', () => {
    expect(appendChainIds(['#2'], [])).toEqual(['#2'])
  })
})

describe('evaluateSeal (#2331)', () => {
  it('leaves a young, small, low-risk train open', () => {
    expect(evaluateSeal(signals(), DEFAULT_TRAIN_LIMITS)).toEqual({ sealed: false })
  })

  it('seals when the chain has reached its size limit', () => {
    const verdict = evaluateSeal(
      signals({ chainSize: DEFAULT_TRAIN_LIMITS.maxChain }),
      DEFAULT_TRAIN_LIMITS,
    )
    expect(verdict.sealed).toBe(true)
    expect(verdict).toMatchObject({ reason: 'max-chain' })
  })

  it('leaves the train open one below the size limit — the boundary is inclusive-to-seal', () => {
    const verdict = evaluateSeal(
      signals({ chainSize: DEFAULT_TRAIN_LIMITS.maxChain - 1 }),
      DEFAULT_TRAIN_LIMITS,
    )
    expect(verdict.sealed).toBe(false)
  })

  it('seals once the train is older than its age budget', () => {
    const verdict = evaluateSeal(
      signals({ now: at('2026-08-22T04:01:00.000Z') }),
      DEFAULT_TRAIN_LIMITS,
    )
    expect(verdict).toMatchObject({ sealed: true, reason: 'max-age' })
  })

  it('seals immediately when the appended issue widens the tier to Standard', () => {
    const verdict = evaluateSeal(signals({ widenedTier: 'Standard' }), DEFAULT_TRAIN_LIMITS)
    expect(verdict).toMatchObject({ sealed: true, reason: 'risk' })
  })

  it('seals on an explicit request regardless of every other signal', () => {
    const verdict = evaluateSeal(signals({ explicitSeal: true }), DEFAULT_TRAIN_LIMITS)
    expect(verdict).toMatchObject({ sealed: true, reason: 'explicit' })
  })

  it('reports risk ahead of size when both hold, so the operator sees the stronger reason', () => {
    const verdict = evaluateSeal(
      signals({ chainSize: DEFAULT_TRAIN_LIMITS.maxChain, widenedTier: 'Standard' }),
      DEFAULT_TRAIN_LIMITS,
    )
    expect(verdict).toMatchObject({ reason: 'risk' })
  })

  it('treats a train with no recorded open time as fresh, never as infinitely old', () => {
    // FAIL-SAFE: a missing timestamp must not seal every train forever.
    const verdict = evaluateSeal(
      signals({ openedAt: undefined, now: at('2027-01-01T00:00:00.000Z') }),
      DEFAULT_TRAIN_LIMITS,
    )
    expect(verdict).toEqual({ sealed: false })
  })

  it('treats an unparseable open time as fresh rather than throwing mid-ship', () => {
    const verdict = evaluateSeal(signals({ openedAt: 'not-a-date' }), DEFAULT_TRAIN_LIMITS)
    expect(verdict).toEqual({ sealed: false })
  })

  it('honours a maxChain of 1 — no batching at all, which is gated-review behaviour today', () => {
    const verdict = evaluateSeal(signals({ chainSize: 1 }), { maxChain: 1, maxAgeMinutes: 240 })
    expect(verdict).toMatchObject({ sealed: true, reason: 'max-chain' })
  })

  it('carries a human-readable detail on every seal so the banner explains itself', () => {
    for (const over of [
      { chainSize: DEFAULT_TRAIN_LIMITS.maxChain },
      { now: at('2026-08-22T04:01:00.000Z') },
      { widenedTier: 'Standard' as const },
      { explicitSeal: true },
    ]) {
      const verdict = evaluateSeal(signals(over), DEFAULT_TRAIN_LIMITS)
      expect(verdict.sealed).toBe(true)
      if (verdict.sealed) expect(verdict.detail.length).toBeGreaterThan(10)
    }
  })
})

/**
 * #2331 — the wiring. `applyChainAdd` runs before the document is seeded, so a refused append
 * must leave state byte-identical: a sealed train never half-applies.
 */
describe('arbiter ship --chain-add (#2331 wiring)', () => {
  let dir: string
  const XS_SIGNALS = { labels: [] as string[], blastRadius: 0, milestoneBundled: false }

  const ship = (opts: Record<string, unknown> = {}) =>
    runTaskShip({
      dir,
      profileOverride: TEST_PROFILE,
      gatherTierSignals: () => XS_SIGNALS,
      now: new Date('2026-08-22T00:10:00.000Z'),
      ...opts,
    })

  const chain = (): string[] => readUnifiedState(dir)?.chainIds ?? []

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-train-'))
    runTaskShip({ dir, taskId: '#100', profileOverride: TEST_PROFILE })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('appends across separate invocations — the accumulating train', () => {
    ship({ chainAddIds: ['#101'] })
    ship({ chainAddIds: ['#102'] })
    expect(chain()).toEqual(['#101', '#102'])
  })

  it('does not clear a live train when no flag is passed', () => {
    ship({ chainAddIds: ['#101'] })
    ship({})
    expect(chain()).toEqual(['#101'])
  })

  it('stamps chainOpened once and never re-stamps it on later appends', () => {
    ship({ chainAddIds: ['#101'] })
    const first = readUnifiedState(dir)?.timestamps?.chainOpened
    ship({ chainAddIds: ['#102'], now: new Date('2026-08-22T01:00:00.000Z') })
    expect(readUnifiedState(dir)?.timestamps?.chainOpened).toBe(first)
  })

  it('refuses the append once the train is full, naming the reason', () => {
    ship({ chainAddIds: ['#101', '#102', '#103'] })
    expect(() => ship({ chainAddIds: ['#104'] })).toThrow(/SEALED: max-chain/)
  })

  it('leaves state untouched when it refuses — a sealed train never half-applies', () => {
    ship({ chainAddIds: ['#101', '#102', '#103'] })
    const before = chain()
    expect(() => ship({ chainAddIds: ['#104'] })).toThrow()
    expect(chain()).toEqual(before)
  })

  it('seals when the appended issue is risk-bearing, without adding it', () => {
    expect(() =>
      ship({
        chainAddIds: ['#101'],
        gatherTierSignals: () => ({ ...XS_SIGNALS, labels: ['epic'] }),
      }),
    ).toThrow(/SEALED: risk/)
    expect(chain()).toEqual([])
  })

  it('judges the appended issue on its own risk, not the train it is joining', () => {
    // Regression guard: widening from the train's tier would seal every append onto a
    // Standard train for a reason that has nothing to do with the incoming issue.
    ship({ chainAddIds: ['#101'], tier: 'Standard' })
    expect(chain()).toEqual(['#101'])
  })

  it('seals on --seal alone, with no ids to add', () => {
    expect(() => ship({ seal: true })).toThrow(/SEALED: explicit/)
  })

  it('counts the primary issue toward the bound — it rides the same gate and PR', () => {
    // maxChain 2 means primary + one chained, so the second append is refused.
    ship({ chainAddIds: ['#101'], trainLimits: { maxChain: 2, maxAgeMinutes: 240 } })
    expect(() =>
      ship({ chainAddIds: ['#102'], trainLimits: { maxChain: 2, maxAgeMinutes: 240 } }),
    ).toThrow(/SEALED: max-chain/)
  })

  it('seals a train that has outlived its age budget', () => {
    ship({ chainAddIds: ['#101'] })
    expect(() =>
      ship({ chainAddIds: ['#102'], now: new Date('2026-08-22T05:00:00.000Z') }),
    ).toThrow(/SEALED: max-age/)
  })
})
