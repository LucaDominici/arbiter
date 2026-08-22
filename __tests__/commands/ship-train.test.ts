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
import { describe, it, expect } from 'vitest'
import { appendChainIds, evaluateSeal, DEFAULT_TRAIN_LIMITS } from '../../src/commands/ship-train'

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
