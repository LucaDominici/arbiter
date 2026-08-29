// SPDX-License-Identifier: Apache-2.0
/**
 * #2400 — bounded review rounds with delta-only re-review.
 *
 * A refactor phase with no convergence rule re-reviews the whole diff after every fix, and
 * every full re-review finds something new: the loop terminates when someone gets tired, not
 * when the change is good. The rule is mechanical — count the rounds, scope round N ≥ 2 to
 * what changed since round N-1, and refuse round `maxRounds + 1` unless a human says so.
 *
 * RED: `review` is not on the task document, no round is ever recorded, and nothing refuses.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_REVIEW_MAX_ROUNDS,
  evaluateReviewRound,
  resolveReviewMaxRounds,
} from '../../src/commands/ship-review'
import { runTaskShip, buildShipStepLines } from '../../src/commands/task-ship'
import { readUnifiedState, writeUnifiedState, reviewStateOf } from '../../src/commands/task-state'
import type { ShipProfile } from '../../src/commands/ship-profile'

const TEST_PROFILE: ShipProfile = {
  isArbiterSelf: false,
  collaborationMode: 'peer-review',
  mergeMode: 'pr-ff',
  governanceLevel: 'L2',
  autonomy: 'L0',
  defaultGateLevel: 'L1',
  companions: [],
}

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)
const SHA_C = 'c'.repeat(40)

describe('resolveReviewMaxRounds (#2400)', () => {
  it('defaults to two rounds', () => {
    expect(DEFAULT_REVIEW_MAX_ROUNDS).toBe(2)
    expect(resolveReviewMaxRounds(undefined)).toBe(2)
    expect(resolveReviewMaxRounds({ train: { maxChain: 3 } })).toBe(2)
  })

  it('takes the declared cap from config', () => {
    expect(resolveReviewMaxRounds({ review: { maxRounds: 4 } })).toBe(4)
  })
})

describe('evaluateReviewRound (#2400)', () => {
  it('allows every round up to the cap', () => {
    expect(evaluateReviewRound({ rounds: 0, maxRounds: 2, forced: false }).allowed).toBe(true)
    expect(evaluateReviewRound({ rounds: 1, maxRounds: 2, forced: false }).allowed).toBe(true)
  })

  it('refuses the round past the cap, naming the cap and both ways out', () => {
    const verdict = evaluateReviewRound({ rounds: 2, maxRounds: 2, forced: false })
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) {
      expect(verdict.detail).toMatch(/2/)
      expect(verdict.detail).toMatch(/arbiter note/)
      expect(verdict.detail).toMatch(/--force-review/)
    }
  })

  it('lets an explicit --force-review through', () => {
    expect(evaluateReviewRound({ rounds: 9, maxRounds: 2, forced: true }).allowed).toBe(true)
  })
})

describe('reviewStateOf migration (#2400)', () => {
  it('AC-2400.1: a document written before review tracking reads as round 0', () => {
    expect(reviewStateOf(null)).toEqual({ rounds: 0, lastReviewedSha: null })
  })

  it('AC-2400.1: an on-disk status.json without a review key migrates to round 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-review-migrate-'))
    try {
      writeUnifiedState(dir, { taskId: '#100' })
      const raw = JSON.parse(
        readFileSync(join(dir, '.claude', '.task', 'status.json'), 'utf-8'),
      ) as Record<string, unknown>
      // Absent by default: a task that never reviews must not grow the key.
      expect(raw['review']).toBeUndefined()
      expect(reviewStateOf(readUnifiedState(dir))).toEqual({ rounds: 0, lastReviewedSha: null })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('review rounds through arbiter ship (#2400 wiring)', () => {
  let dir: string

  const ship = (opts: Record<string, unknown> = {}) =>
    runTaskShip({ dir, profileOverride: TEST_PROFILE, ...opts })

  const review = () => reviewStateOf(readUnifiedState(dir))
  const log = (): string => readFileSync(join(dir, '.claude', '.task', 'log.md'), 'utf-8')

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-review-'))
    runTaskShip({ dir, taskId: '#100', profileOverride: TEST_PROFILE })
    writeUnifiedState(dir, { phase: 'green' })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('AC-2400.1: advancing into refactor records round 1 and pins HEAD', () => {
    ship({ advance: true, headSha: SHA_A })
    expect(review()).toEqual({ rounds: 1, lastReviewedSha: SHA_A })
  })

  it('AC-2400.1: the round lands in the digest log with the short sha', () => {
    ship({ advance: true, headSha: SHA_A })
    expect(log()).toContain(`review → round 1 at ${SHA_A.slice(0, 7)}`)
  })

  it('AC-2400.1: --review-round records the next round and re-pins HEAD', () => {
    ship({ advance: true, headSha: SHA_A })
    ship({ reviewRound: true, headSha: SHA_B })
    expect(review()).toEqual({ rounds: 2, lastReviewedSha: SHA_B })
  })

  it('does not burn a round just for re-reading the step', () => {
    ship({ advance: true, headSha: SHA_A })
    ship({ headSha: SHA_B })
    ship({ headSha: SHA_C })
    expect(review().rounds).toBe(1)
  })

  it('AC-2400.2: refuses a third round without --force-review, leaving state untouched', () => {
    ship({ advance: true, headSha: SHA_A })
    ship({ reviewRound: true, headSha: SHA_B })
    const before = review()
    expect(() => ship({ reviewRound: true, headSha: SHA_C })).toThrow(/REVIEW ROUNDS EXHAUSTED/)
    expect(review()).toEqual(before)
  })

  it('AC-2400.2: --force-review takes the extra round and records that it was forced', () => {
    ship({ advance: true, headSha: SHA_A })
    ship({ reviewRound: true, headSha: SHA_B })
    ship({ reviewRound: true, forceReview: true, headSha: SHA_C })
    expect(review()).toMatchObject({ rounds: 3, lastReviewedSha: SHA_C, forced: true })
    expect(log()).toContain('forced')
  })

  it('AC-2400.2: `forced` is sticky — a later ordinary round never erases the record', () => {
    ship({ advance: true, headSha: SHA_A })
    ship({ reviewRound: true, forceReview: true, headSha: SHA_B })
    ship({ reviewRound: true, reviewMaxRounds: 9, headSha: SHA_C })
    expect(review()).toMatchObject({ rounds: 3, forced: true })
  })

  it('honours a cap declared in arbiter.json', () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({
        version: '0.2',
        governanceLevel: 'L2',
        tools: ['claude'],
        useGitHub: false,
        features: {
          contractTesting: false,
          mutationTesting: false,
          securityScanning: false,
          evidenceHarness: false,
          debtGates: true,
          suppressions: true,
        },
        thresholds: {
          lineCoverage: 80,
          branchCoverage: 70,
          mutationScore: 80,
          cyclomaticComplexity: 15,
          methodLength: 65,
          maxParams: 7,
        },
        ship: { review: { maxRounds: 1 } },
      }),
    )
    ship({ advance: true, headSha: SHA_A })
    expect(() => ship({ reviewRound: true, headSha: SHA_B })).toThrow(/REVIEW ROUNDS EXHAUSTED/)
  })

  it('counts the round when HEAD cannot be read — an unreadable sha never disarms the cap', () => {
    ship({ advance: true, headSha: null })
    expect(review()).toEqual({ rounds: 1, lastReviewedSha: null })
  })

  it('AC-2400.3: round 2 prints the delta scope and the severity rule', () => {
    ship({ advance: true, headSha: SHA_A })
    const result = ship({ reviewRound: true, headSha: SHA_B })
    const lines = buildShipStepLines(result)
    const scope = lines.find((l) => l.startsWith('Review scope:'))
    expect(scope).toBeDefined()
    expect(scope).toContain(`git diff ${SHA_A}..HEAD`)
    expect(scope).toContain('round 2 of 2')
    expect(scope).toContain('reviewer findings below HIGH do not block landing')
  })

  it('AC-2400.3: round 1 reviews the whole diff, so it prints no delta scope', () => {
    const result = ship({ advance: true, headSha: SHA_A })
    expect(buildShipStepLines(result).some((l) => l.startsWith('Review scope:'))).toBe(false)
  })
})
