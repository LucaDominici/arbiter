// SPDX-License-Identifier: Apache-2.0
/**
 * #2400 — bounded review rounds: the convergence rule for the `refactor` phase.
 *
 * A review loop with no bound does not converge, it exhausts. Every full re-review of a growing
 * diff finds something new, so "review until clean" terminates when someone gets tired rather
 * than when the change is good — one PR spent ~22h and ~40 hardening commits in `refactor` that
 * way. Two things fix it, and both are mechanical: count the rounds against a declared cap, and
 * scope round N ≥ 2 to what changed since round N-1 instead of re-reading the whole diff.
 *
 * This module is that decision and only that decision: pure, deterministic, no I/O. Reading
 * state, resolving HEAD and acting on the verdict belong to the caller.
 *
 * CANON-16 existing-code survey: grepped `src/` for `export function .*[Rr]eview|[Rr]ound` — the
 * hits were `reviewPhaseStepBody` (step TEXT for a phase, in task-ship.ts), `planCrossModelSlots`
 * (which reviewer seats a panel gets, in integrations/external-review.ts) and
 * `resolveCrossModelReview` (config → provider settings, in ship-profile.ts). None decides
 * whether another round may run at all. New file justified for the same reason `ship-train.ts`
 * was: a pure per-invocation policy verdict, named into the established `ship-<concern>.ts`
 * family, kept out of task-ship.ts which is already at its complexity ceiling.
 */
import type { ShipConfig } from '../config/schema.js'

/**
 * Two rounds. One review, one re-review of the fixes: the second round is where a genuine
 * regression from the first round's changes shows up, and the third is where the loop starts
 * feeding on itself. A project that wants a different bound declares `ship.review.maxRounds`.
 */
export const DEFAULT_REVIEW_MAX_ROUNDS = 2

/** The cap this repo runs under: `ship.review.maxRounds`, else the built-in default. */
export function resolveReviewMaxRounds(ship: ShipConfig | undefined): number {
  return ship?.review?.maxRounds ?? DEFAULT_REVIEW_MAX_ROUNDS
}

interface ReviewRoundSignals {
  /** Rounds already recorded on this task, BEFORE the one being requested. */
  rounds: number
  maxRounds: number
  /** `--force-review`: a human has decided this task earns another round. */
  forced: boolean
}

type ReviewRoundVerdict = { allowed: true } | { allowed: false; detail: string }

export interface PlannedReviewRound {
  rounds: number
  maxRounds: number
  base: string | null
  head: string | null
  forced: boolean
}

/**
 * May another review round run?
 *
 * The refusal names BOTH exits, because a cap that only says "no" just gets bypassed: land the
 * change with the remaining findings parked, or take the round deliberately with `--force-review`.
 * The cap bounds cost, never severity. Applicable MED/HIGH/CRITICAL findings still block.
 */
export function evaluateReviewRound(signals: ReviewRoundSignals): ReviewRoundVerdict {
  if (signals.forced) return { allowed: true }
  if (signals.rounds < signals.maxRounds) return { allowed: true }
  return {
    allowed: false,
    detail:
      `this task has already had ${signals.rounds} review round(s) and the cap is ${signals.maxRounds}. ` +
      'BLOCKED: resolve or refute every applicable MED/HIGH/CRITICAL finding before landing, ' +
      'or pass --force-review to take another round deliberately. Only LOW findings may be parked.',
  }
}

export function planReviewRound(
  previous: { rounds: number; lastReviewedSha: string | null; forced?: boolean },
  maxRounds: number,
  head: string | null,
  forced: boolean,
): PlannedReviewRound | { allowed: false; detail: string } {
  const verdict = evaluateReviewRound({ rounds: previous.rounds, maxRounds, forced })
  if (!verdict.allowed) return verdict
  return {
    rounds: previous.rounds + 1,
    maxRounds,
    base: previous.lastReviewedSha,
    head,
    forced,
  }
}

/**
 * The scope line for a re-review. Printed only for the round it describes — a round is a
 * dispatch, not a state the phase sits in, so re-reading the step never re-prints it.
 *
 * The severity clause is scoped to REVIEWER findings on purpose: the ac-fit verdicts are a
 * separate, hard-gated artifact (`check-acceptance` requires all-PASS at verification/close),
 * and nothing here relaxes them.
 */
export function reviewScopeLine(base: string, rounds: number, maxRounds: number): string {
  return (
    `git diff ${base}..HEAD (round ${rounds} of ${maxRounds}) · ` +
    'only LOW findings may be parked; applicable MED/HIGH/CRITICAL and AC-fit failures still block'
  )
}
