// SPDX-License-Identifier: Apache-2.0
/**
 * #2331 — bounded sealed trains: the stop rule for `--chain-add`.
 *
 * `gate-pass.json` binds to an exact HEAD, so every commit after a gate forces a re-run: N issues
 * cost N gate cycles and N PRs. `--chain` (#2102) already collapses that to one worktree / one
 * branch / N commits / one gate / one PR, and the pre-push hook enforces it. What it lacks is a
 * decision layer — the batch must be declared by hand up front, and nothing says when to stop
 * adding. An unbounded batch is not a train, it is a long-lived branch.
 *
 * This module is that decision, and only that decision: pure, deterministic, no I/O. Reading
 * state and acting on the verdict belong to the caller.
 *
 * CANON-16 existing-code survey: grepped `src/` for `export function .*[Ss]eal|[Tt]rain|[Bb]atch`
 * and `.*[Cc]hain` — the only hits were `resolveDefaultAffinityBatching` (the consumer-less knob
 * tracked by #2329) and `normalizeChainId` in `task-state.ts`, which this module reuses rather
 * than reimplements. No existing home fits: `ship-tier.ts` decides review breadth for ONE issue
 * and `ship-profile.ts` resolves config, while this decides a batch boundary across issues. New
 * file justified, named into the established `src/commands/ship-<concern>.ts` family.
 */
import { normalizeChainId } from './task-state.js'
import type { ShipTier } from './ship-tier.js'

/** Bounds on how far one train may grow before it must be landed. */
export interface TrainLimits {
  /** Total ids on the branch (primary + chained) at which the next append is refused. */
  maxChain: number
  /** Age of the open train, in minutes, past which the next append is refused. */
  maxAgeMinutes: number
}

/**
 * Every input is available BEFORE the appended issue has a diff — which is the binding
 * constraint, since the append decision is made at that moment. `widenedTier` therefore comes
 * from `widenTier(gatherTierSignals(...))` (issue labels, milestone, graph blast-radius) and
 * never from the diff-derived security-surface escalation, which cannot be evaluated yet.
 */
export interface TrainSignals {
  /** Ids already on the branch, primary included, BEFORE this append. */
  chainSize: number
  /** `timestamps.chainOpened`, or undefined for a train that has not opened yet. */
  openedAt: string | undefined
  now: Date
  /** Pre-implementation tier for the issue being appended. */
  widenedTier: ShipTier
  explicitSeal: boolean
}

type SealReason = 'explicit' | 'risk' | 'max-chain' | 'max-age'

type SealVerdict = { sealed: false } | { sealed: true; reason: SealReason; detail: string }

/**
 * Four ids and four hours. Both are deliberately unremarkable: the age budget matches the
 * existing `ARBITER_PREPUSH_MAX_AGE_MIN` evidence budget (`.githooks/pre-push`), so a train
 * cannot outlive the gate evidence it is accumulating toward.
 */
export const DEFAULT_TRAIN_LIMITS: TrainLimits = { maxChain: 4, maxAgeMinutes: 240 }

/**
 * Append ids to a chain, normalizing and de-duplicating while preserving arrival order.
 *
 * `--chain` REPLACES (`seedShipState` shallow-merges the doc), which is right for a batch
 * declared up front and useless for one that accumulates. Normalization is delegated to
 * `normalizeChainId` so a malformed id is rejected here rather than reaching the pre-push
 * `#<id>` commit scan, where it would fail as a missing commit instead of a bad argument.
 */
export function appendChainIds(
  existing: readonly string[],
  additions: readonly string[],
): string[] {
  const result = [...existing]
  const seen = new Set(existing)
  for (const raw of additions) {
    const id = normalizeChainId(raw)
    if (seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}

/** Minutes elapsed, or null when the open time is absent or unparseable. */
function ageMinutes(openedAt: string | undefined, now: Date): number | null {
  if (openedAt === undefined) return null
  const opened = Date.parse(openedAt)
  if (Number.isNaN(opened)) return null
  return (now.getTime() - opened) / 60_000
}

/**
 * Decide whether the train must be sealed before taking another id.
 *
 * Precedence is by strength of the reason, not by cost of the check: an operator who hits both
 * a risk boundary and the size limit needs to be told about the risk. `explicit` outranks
 * everything because it is a human decision already made.
 *
 * FAIL-SAFE on age: a missing or unparseable `openedAt` reads as FRESH, never as infinitely old.
 * The opposite default would turn one corrupt timestamp into a train that can never accept
 * another issue, and the failure would look like policy rather than corruption.
 */
export function evaluateSeal(signals: TrainSignals, limits: TrainLimits): SealVerdict {
  if (signals.explicitSeal) {
    return { sealed: true, reason: 'explicit', detail: 'sealed on explicit request (--seal)' }
  }
  if (signals.widenedTier === 'Standard') {
    return {
      sealed: true,
      reason: 'risk',
      detail:
        'the issue being added widens the tier to Standard — a risk-bearing issue rides its own train',
    }
  }
  if (signals.chainSize >= limits.maxChain) {
    return {
      sealed: true,
      reason: 'max-chain',
      detail: `the train already carries ${signals.chainSize} issue(s), the limit is ${limits.maxChain}`,
    }
  }
  const age = ageMinutes(signals.openedAt, signals.now)
  if (age !== null && age > limits.maxAgeMinutes) {
    return {
      sealed: true,
      reason: 'max-age',
      detail: `the train has been open ${Math.round(age)} min, the budget is ${limits.maxAgeMinutes} min`,
    }
  }
  return { sealed: false }
}
