// SPDX-License-Identifier: Apache-2.0
//
// #1260 — pure ship-SIZE scorer for `arbiter ship`.
//
// Size is ALWAYS computed (no flag). It drives TWO things at the review/verify phase:
//   1. the review-agent COUNT — by auto-selecting the existing review TIER (XS|S|Standard),
//      so every existing tier→count lookup (task-ship.ts, ship.md, DEFAULT_TASK_TIERS)
//      scales for free without redefining any count literal here, and
//   2. an orthogonal VERTICAL floor — larger size widens the *breadth* of review
//      verticals, not just the count, for max depth AND breadth.
//
// Re-derived (NOT copied) from a prior internal framework's `/task` size buckets + `plan-review-verticals.sh`.
// Crucially, the vertical vocabulary is arbiter's OWN `auditor-routing.json` auditor names
// (bugs/type-safety/domain/test-quality/security/data-integrity/silent-failures) so the
// floor plugs straight into the real scorer (scripts/route-auditors.mjs) and #1267's
// dispatch matrix — it is never free text.
//
// This module is pure (no I/O) so the git adapter (./diff-signals.ts) and the #1267
// dispatch-matrix lane can reuse it without forming a cycle. Mirrors the pure-scorer /
// adapter split established by src/affinity/ (#1259).

/** The review tiers size maps onto (same vocabulary the count maps already key on). */
export type ShipSizeTier = 'XS' | 'S' | 'Standard'

/**
 * FAIL-SAFE default: when no size signal exists, degrade to the WIDEST tier (most
 * review agents + full vertical breadth). A lost/absent signal must never NARROW
 * review — under-reviewing on signal loss is the dangerous direction (#1260 RT-02).
 */
export const DEFAULT_SHIP_TIER: ShipSizeTier = 'Standard'

/** Change signals the size rubric scores over. All optional; absence → default. */
export interface SizeSignals {
  /** Files touched in the diff (git numstat row count). */
  filesChanged?: number
  /** Total added+deleted lines in the diff. */
  linesChanged?: number
  /** Implementation unit count from the plan (§7) — the pre-impl fallback signal. */
  units?: number
}

/** A computed size: the selected tier + the orthogonal vertical floor for it. */
export interface ShipSize {
  tier: ShipSizeTier
  /** Auditor-routing vertical names the size floor activates (breadth). */
  verticals: string[]
}

// ── Size buckets (re-derived) ────────────────────────────────────────────────
// Diff: a change is XS when it is small in BOTH files and lines; Standard when it
// is large in EITHER; S otherwise. Thresholds are deliberately conservative so a
// borderline change rounds UP (toward more review), consistent with the fail-safe.
const DIFF_XS_MAX_FILES = 2
const DIFF_XS_MAX_LINES = 40
const DIFF_STD_MIN_FILES = 8
const DIFF_STD_MIN_LINES = 300

// Units fallback buckets (mirror the diff intent on the plan's unit estimate).
const UNITS_XS_MAX = 3
const UNITS_STD_MIN = 20

function tierFromDiff(filesChanged: number, linesChanged: number): ShipSizeTier {
  if (filesChanged >= DIFF_STD_MIN_FILES || linesChanged >= DIFF_STD_MIN_LINES) return 'Standard'
  if (filesChanged <= DIFF_XS_MAX_FILES && linesChanged <= DIFF_XS_MAX_LINES) return 'XS'
  return 'S'
}

function tierFromUnits(units: number): ShipSizeTier {
  if (units <= UNITS_XS_MAX) return 'XS'
  if (units >= UNITS_STD_MIN) return 'Standard'
  return 'S'
}

// ── Vertical floor (orthogonal breadth) ──────────────────────────────────────
// Each tier UNIONS strictly more auditor-routing verticals than the smaller tier.
// XS = the always_on triad; S adds test-quality; Standard adds the heavy verticals.
const FLOOR_XS = ['bugs', 'type-safety', 'domain'] as const
const FLOOR_S_ADD = ['test-quality'] as const
const FLOOR_STD_ADD = ['security', 'data-integrity', 'silent-failures'] as const

/**
 * The orthogonal vertical FLOOR for a tier — real auditor-routing.json names, in a
 * stable widening order. `route-auditors.mjs --size-floor <tier>` and #1267's dispatch
 * matrix union this set into the file-path-selected auditors (it only ever ADDS).
 */
export function sizeVerticals(tier: ShipSizeTier): string[] {
  const xs = [...FLOOR_XS]
  if (tier === 'XS') return xs
  const s = [...xs, ...FLOOR_S_ADD]
  if (tier === 'S') return s
  return [...s, ...FLOOR_STD_ADD]
}

/**
 * Compute the ship size from change signals. Precedence: diff (files+LOC) when a diff
 * exists > units (plan estimate) > DEFAULT_SHIP_TIER (widest, fail-safe). Pure + total
 * — never throws; an empty/zero signal set yields the default.
 */
export function computeShipSize(signals: SizeSignals): ShipSize {
  const files = signals.filesChanged ?? 0
  const lines = signals.linesChanged ?? 0
  let tier: ShipSizeTier
  if (files > 0 || lines > 0) {
    tier = tierFromDiff(files, lines)
  } else if (signals.units !== undefined && signals.units > 0) {
    tier = tierFromUnits(signals.units)
  } else {
    tier = DEFAULT_SHIP_TIER
  }
  return { tier, verticals: sizeVerticals(tier) }
}
