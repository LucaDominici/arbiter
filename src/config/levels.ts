// SPDX-License-Identifier: Apache-2.0
import type { GovernanceLevel } from '../wizard/types.js'

/**
 * The single ordinal SSOT for governance levels: `L4 ⊇ L3 ⊇ L2 ⊇ L1` (#1516).
 *
 * Before this module the ordinal relationship was encoded only by repetition —
 * the "at least L3" boundary was spelled `level === 'L3' || level === 'L4'`
 * verbatim across a dozen files, and the "at least L2" boundary as
 * `level !== 'L1'`. None of those idioms had compiler help, none were typed,
 * and a typo (`=== 'L3' || === 'L3'`) was silently wrong. This promotes the
 * previously module-private `LEVEL_ORDER`/`meetsGovernanceLevel` pair from
 * `src/invariants/filter.ts` into a shared, exported, ordinal API.
 */
export const LEVEL_ORDER = ['L1', 'L2', 'L3', 'L4'] as const

/** Ordinal rank of a governance level (L1 = 0 … L4 = 3). */
export function levelRank(level: GovernanceLevel): number {
  return LEVEL_ORDER.indexOf(level)
}

/**
 * True when `actual` governance level is at least as strict as `min`
 * (i.e. `actual` is `min` or any higher tier). Replaces the repeated
 * `x === 'L3' || x === 'L4'` and `x !== 'L1'` boundary idioms.
 */
export function levelAtLeast(actual: GovernanceLevel, min: GovernanceLevel): boolean {
  return levelRank(actual) >= levelRank(min)
}
