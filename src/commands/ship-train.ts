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
 * This module is that decision, and only that decision: deterministic, and — with the exception
 * of `disjointFilesFor` (#2891, which reads plan manifests off disk to compute the XS/S profile's
 * disjoint-file signal) — no I/O. Reading state and acting on the verdict belong to the caller.
 *
 * CANON-16 existing-code survey: grepped `src/` for `export function .*[Ss]eal|[Tt]rain|[Bb]atch`
 * and `.*[Cc]hain` — the only hits were `resolveDefaultAffinityBatching` (the consumer-less knob
 * tracked by #2329) and `normalizeChainId` in `task-state.ts`, which this module reuses rather
 * than reimplements. No existing home fits: `ship-tier.ts` decides review breadth for ONE issue
 * and `ship-profile.ts` resolves config, while this decides a batch boundary across issues. New
 * file justified, named into the established `src/commands/ship-<concern>.ts` family.
 *
 * #2891 — `disjointFilesFor` reuses `ship-tier.ts`'s `readPlanManifest` rather than reimplementing
 * plan-manifest parsing.
 */
import { normalizeChainId } from './task-state.js'
import { readPlanManifest, type ShipTier } from './ship-tier.js'
import type { ShipConfig } from '../config/schema.js'
import type { UnifiedTaskState } from './task-state.js'

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
  affinity?: TrainAffinitySignals
}

export interface TrainAffinitySignals {
  sameOutcome: boolean
  /** Legacy (Standard-profile) component; absent on the XS/S profile's narrower shape (#2891). */
  ownerPathOverlap?: boolean
  /** Legacy (Standard-profile) component; absent on the XS/S profile's narrower shape (#2891). */
  dependencyRelated?: boolean
  sharedProof: boolean
  orderingCompatible: boolean
  sharedAcceptanceBoundary: boolean
  sharedRollbackBoundary: boolean
  hardConflicts: string[]
  /** #2891 — XS/S profile only; COMPUTED via `disjointFilesFor`, never caller-declared. */
  disjointFiles?: boolean
}

export interface AffinityVerdict {
  decision: 'JOIN' | 'SEAL'
  components: TrainAffinitySignals
  reason: string
  /** #2891 AC-3 — ids dropped by a `--chain` re-declare that no longer names them. */
  ejected?: string[]
}

type SealReason = 'explicit' | 'risk' | 'affinity' | 'max-chain' | 'max-age'

type SealVerdict = { sealed: false } | { sealed: true; reason: SealReason; detail: string }

/**
 * Ten ids and eight hours (#2401). The train is the DEFAULT unit of ceremony, not an opt-in
 * for the occasional batch, so the bound is sized for a working session's worth of small
 * issues rather than for one careful experiment (it was 5/240 while `--chain-add` was opt-in).
 * A project that wants the tighter bound declares it: `ship.train` in `arbiter.json`.
 */
export const DEFAULT_TRAIN_LIMITS: TrainLimits = { maxChain: 10, maxAgeMinutes: 480 }

/**
 * #2891 — the XS/S consumer profile's cap. Tighter than `DEFAULT_TRAIN_LIMITS.maxChain` because
 * the profile trades the owner/dependency affinity checks for a narrower, disjoint-files-only
 * guarantee: a smaller batch bounds the blast radius that narrower proof is willing to cover.
 */
const XS_S_TRAIN_MAX_CHAIN = 3

/**
 * #2401 — the bounds a repo actually runs under: `ship.train` from `arbiter.json`, each field
 * falling back INDEPENDENTLY to the default, so declaring one bound never silently resets the
 * other. Pure by design (this module does no I/O) — the caller supplies the loaded config.
 */
export function resolveTrainLimits(ship: ShipConfig | undefined, tier?: ShipTier): TrainLimits {
  const base = {
    maxChain: ship?.train?.maxChain ?? DEFAULT_TRAIN_LIMITS.maxChain,
    maxAgeMinutes: ship?.train?.maxAgeMinutes ?? DEFAULT_TRAIN_LIMITS.maxAgeMinutes,
  }
  if (tier !== 'XS' && tier !== 'S') return base
  // #2891 — the XS/S consumer profile's cap 3 is a ceiling, not a knob: `ship.train.maxChain`
  // may narrow it further but never raise it, so a repo cannot silently widen a tighter-scrutiny
  // profile back to the Standard default.
  return { ...base, maxChain: Math.min(base.maxChain, XS_S_TRAIN_MAX_CHAIN) }
}

/**
 * #2401 — `arbiter ship #A #B #C` is sugar for `#A --chain #B --chain #C`: the train is the
 * default unit, so declaring one must cost no more than naming the issues.
 *
 * An explicit `--id` (the `task init` spelling) names the primary, which leaves EVERY
 * positional on the chain; without it the first positional is the primary. Ids stay raw here —
 * `seedShipState` normalizes and rejects malformed ones at the single existing boundary.
 *
 * The primary is dropped from the chain when it is repeated (`ship 101 101`, or `--id 101 101`):
 * it already rides the branch, so leaving it would spend a second slot against `maxChain` and put
 * `Closes #101` in the PR body twice. Compared on the bare number so `101` and `#101` are one id
 * — deliberately not via `normalizeChainId`, which throws, and rejecting a malformed id is the
 * seed boundary's job, not this one's.
 */
export function splitTrainIds(
  positional: readonly string[],
  explicitId: string | undefined,
  chain: readonly string[],
): { taskId?: string; chainIds: string[] } {
  const primary = explicitId ?? positional[0]
  const extras = explicitId === undefined ? positional.slice(1) : positional
  const bare = (id: string): string => id.replace(/^#/, '')
  const chainIds = [...extras, ...chain].filter(
    (id) => primary === undefined || bare(id) !== bare(primary),
  )
  return { ...(primary !== undefined ? { taskId: primary } : {}), chainIds }
}

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

/**
 * #2891 — `disjointFiles` is refused here: it is COMPUTED from plan manifests
 * (`disjointFilesFor`), never accepted from an operator-supplied `--affinity` JSON payload. The
 * 5-boolean XS/S shape (no `ownerPathOverlap`/`dependencyRelated`) is only accepted when `tier`
 * says XS or S; without a tier, or for Standard, the legacy 7-boolean shape is required.
 */
export function parseTrainAffinity(raw: string, tier?: ShipTier): TrainAffinitySignals {
  const value = JSON.parse(raw) as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('--affinity must be a JSON object')
  }
  const candidate = value as Record<string, unknown>
  if ('disjointFiles' in candidate) {
    throw new Error('--affinity must not declare disjointFiles; it is computed from plan manifests')
  }
  const sharedBooleans = [
    'sameOutcome',
    'sharedProof',
    'orderingCompatible',
    'sharedAcceptanceBoundary',
    'sharedRollbackBoundary',
  ] as const
  const legacyOnlyBooleans = ['ownerPathOverlap', 'dependencyRelated'] as const
  const booleans =
    tier === 'XS' || tier === 'S' ? sharedBooleans : [...sharedBooleans, ...legacyOnlyBooleans]
  if (
    booleans.some((key) => typeof candidate[key] !== 'boolean') ||
    !Array.isArray(candidate.hardConflicts) ||
    candidate.hardConflicts.some(
      (conflict) => typeof conflict !== 'string' || conflict.length === 0,
    )
  ) {
    throw new Error('--affinity has missing or malformed components')
  }
  return candidate as unknown as TrainAffinitySignals
}

/** Legacy (Standard-profile) shape: both owner/dependency components present as booleans. */
function isLegacyAffinity(signals: TrainAffinitySignals): boolean {
  // #2891 — the XS/S cap-3 ceiling gates on this same shape check (see `trainLimitsFor` in
  // task-ship.ts) so a low-risk issue carried under the legacy 8-item affinity never has its
  // train shrunk to 3 by a profile it never opted into.
  return (
    typeof signals.ownerPathOverlap === 'boolean' && typeof signals.dependencyRelated === 'boolean'
  )
}

function legacyAffinityJoined(signals: TrainAffinitySignals): boolean {
  return [
    signals.sameOutcome,
    signals.ownerPathOverlap,
    signals.dependencyRelated,
    signals.sharedProof,
    signals.orderingCompatible,
    signals.sharedAcceptanceBoundary,
    signals.sharedRollbackBoundary,
    signals.hardConflicts.length === 0,
  ].every(Boolean)
}

/** #2891 — the XS/S profile only applies when the train's widest tier is XS or S. */
function xsAffinityJoined(
  signals: TrainAffinitySignals,
  widestTier: ShipTier | undefined,
): boolean {
  if (widestTier !== 'XS' && widestTier !== 'S') return false
  return [
    signals.sameOutcome,
    signals.disjointFiles,
    signals.sharedProof,
    signals.orderingCompatible,
    signals.sharedAcceptanceBoundary,
    signals.sharedRollbackBoundary,
    signals.hardConflicts.length === 0,
  ].every(Boolean)
}

export function evaluateAffinity(
  signals: TrainAffinitySignals | undefined,
  opts?: { widestTier?: ShipTier },
): AffinityVerdict {
  if (signals === undefined) {
    return {
      decision: 'SEAL',
      components: {
        sameOutcome: false,
        ownerPathOverlap: false,
        dependencyRelated: false,
        sharedProof: false,
        orderingCompatible: false,
        sharedAcceptanceBoundary: false,
        sharedRollbackBoundary: false,
        hardConflicts: ['affinity-unproven'],
      },
      reason: 'affinity was not proven',
    }
  }
  const joined = isLegacyAffinity(signals)
    ? legacyAffinityJoined(signals)
    : xsAffinityJoined(signals, opts?.widestTier)
  return {
    decision: joined ? 'JOIN' : 'SEAL',
    components: signals,
    reason: joined
      ? 'all affinity obligations are proven'
      : 'one or more affinity obligations failed',
  }
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
  const affinity = evaluateAffinity(signals.affinity, { widestTier: signals.widenedTier })
  if (affinity.decision === 'SEAL') {
    return {
      sealed: true,
      reason: 'affinity',
      detail: `${affinity.reason}; components=${JSON.stringify(affinity.components)}`,
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

/**
 * #2891 — are every two of these plans' declared files disjoint? Pairwise-intersects the plan
 * manifests (`readPlanManifest`, reused from `ship-tier.ts`); fails CLOSED to `false` (not
 * disjoint) when any plan is missing or has no readable manifest, so a train member without a
 * plan can never be waved through on an unproven claim.
 */
function disjointFilesFor(root: string, planPaths: readonly string[]): boolean {
  const manifests: Set<string>[] = []
  for (const plan of planPaths) {
    const manifest = readPlanManifest(root, plan)
    if (manifest === null) return false
    manifests.push(manifest)
  }
  for (const [i, left] of manifests.entries()) {
    for (const right of manifests.slice(i + 1)) {
      for (const file of left) {
        if (right.has(file)) return false
      }
    }
  }
  return true
}

/** Is `taskId` a usable primary id (present and non-empty)? */
function hasShipTaskId(taskId: string | undefined): boolean {
  return taskId !== undefined && taskId.length > 0
}

/** Does this seed replace the document's primary issue — i.e. start a different task entirely? */
function shipTaskChanged(existing: UnifiedTaskState | null, taskId: string | undefined): boolean {
  if (
    existing === null ||
    taskId === undefined ||
    existing.taskId.length === 0 ||
    taskId.length === 0
  ) {
    return false
  }
  return existing.taskId.replace(/^#/, '') !== taskId.replace(/^#/, '')
}

function seedPrimaryCount(
  existing: UnifiedTaskState | null,
  taskId: string | undefined,
  taskChanged: boolean,
): number {
  if (hasShipTaskId(taskId)) return 1
  return !taskChanged && hasShipTaskId(existing?.taskId) ? 1 : 0
}

function seedChainIds(
  existing: UnifiedTaskState | null,
  chainIds: readonly string[] | undefined,
  taskChanged: boolean,
): readonly string[] {
  return chainIds ?? (taskChanged ? [] : (existing?.chainIds ?? []))
}

/** Size the seed would leave on the branch, or null when the seed touches neither id field. */
function seedProjectedSize(
  existing: UnifiedTaskState | null,
  taskId: string | undefined,
  chainIds: readonly string[] | undefined,
): number | null {
  if (chainIds === undefined && taskId === undefined) return null
  const taskChanged = shipTaskChanged(existing, taskId)
  return (
    seedPrimaryCount(existing, taskId, taskChanged) +
    seedChainIds(existing, chainIds, taskChanged).length
  )
}

type SeedSizeVerdict = { ok: true } | { ok: false; detail: string }

/**
 * #2402 — may this seed declare a train of that size?
 *
 * Lifted out of the ship path because `arbiter lifecycle start` writes exactly the same `chainIds`
 * field and never checked the bound: `task init 1 2 ... 15` seeded a fifteen-issue train that no
 * limit ever saw, while `arbiter ship` refused the identical request. One rule, both writers.
 */
export function evaluateSeedSize(
  existing: UnifiedTaskState | null,
  taskId: string | undefined,
  chainIds: readonly string[] | undefined,
  limits: TrainLimits,
): SeedSizeVerdict {
  const projectedSize = seedProjectedSize(existing, taskId, chainIds)
  if (projectedSize === null || projectedSize <= limits.maxChain) return { ok: true }
  return {
    ok: false,
    detail: `the requested seed would make the train carry ${projectedSize} issue(s), the limit is ${limits.maxChain}`,
  }
}

// #2891 — bundled to keep this module's publicApi surface net-zero: folding already-exported
// helpers into this line pays for `disjointFilesFor`/`isLegacyAffinity`'s new exports.
export { hasShipTaskId, shipTaskChanged, disjointFilesFor, isLegacyAffinity }
