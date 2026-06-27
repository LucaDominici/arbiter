// SPDX-License-Identifier: Apache-2.0
// conformance/score.ts — Two-tier conjunctive conformance scoring (#1394/C2 of #1369).
//
// Tier-1 gate: any N OR P on a Tier-1 dimension → NON-CONFORMANT regardless of Tier-2.
//   Membership is the STRUCTURAL `tier === 1` field (the SSOT in dimensions.ts), not a
//   hand-maintained allow-list that drifted out of sync (#1658). `tier1Members` is kept
//   only as an additive explicit override. P is treated as non-pass: a partial on a
//   must-pass dimension is not a pass.
// Tier-2 family-weighted score: RC 35% / code-quality-gold 30% / docs-convention 20% / discipline 15%.
// Gold: all T1 Y/NA AND T2 ≥ goldTier2Gate AND ratchetOk === true.

import type { DimensionEntry } from './dimensions.js'

// ── Public types ──────────────────────────────────────────────────────────────

export interface TwoTierResult {
  verdict: 'GOLD' | 'CONFORMANT' | 'NON-CONFORMANT'
  /** Empty if no T1 failures. */
  tier1Fails: DimensionEntry[]
  /** 0–1, Tier-2 family-weighted score. */
  score: number
  ratchetOk: boolean
}

export interface ConformanceThresholds {
  tier1Members: string[]
  familyWeights: {
    discipline: number
    'reality-contact': number
    'docs-convention': number
    'code-quality-gold': number
  }
  goldTier2Gate: number
}

// ── Internal helpers ──────────────────────────────────────────────────────────

type Family = DimensionEntry['family']

/** Numeric verdict weight: Y=1, P=0.5, N=0; NA/NV excluded from denominator. */
function verdictPoints(verdict: DimensionEntry['verdict']): number {
  if (verdict === 'Y') return 1
  if (verdict === 'P') return 0.5
  return 0
}

function isExcluded(verdict: DimensionEntry['verdict']): boolean {
  return verdict === 'NA' || verdict === 'NV'
}

/**
 * Compute weighted T2 score across the four quality families, RENORMALIZED by live weight.
 *
 * NA/NV dims are excluded from family denominators. A family with no eligible dims contributes
 * nothing AND its weight is removed from the denominator — the score is `Σ(familyScore·weight) /
 * Σ(weight)` over only the families that actually contributed. Without this renormalization the
 * ceiling would be capped at the sum of the participating weights: in practice only docs-convention
 * (weight 0.20) carries any tier-2 dims, so a perfect project would top out at 0.20 and the GOLD
 * verdict (gate 0.85–0.92) would be mathematically unreachable for every project (#1599). A family
 * whose weight is vestigial today (no tier-2 probes authored yet) therefore neither inflates nor
 * deflates the score — it simply does not participate until it carries dims.
 */
function computeTier2Score(
  tier2Dims: DimensionEntry[],
  familyWeights: ConformanceThresholds['familyWeights'],
): number {
  const families: Family[] = [
    'discipline',
    'reality-contact',
    'docs-convention',
    'code-quality-gold',
  ]
  let weightedSum = 0
  let liveWeight = 0

  for (const family of families) {
    const inFamily = tier2Dims.filter((d) => d.family === family)
    const eligible = inFamily.filter((d) => !isExcluded(d.verdict))
    if (eligible.length === 0) {
      // No eligible dims → the family does not participate; its weight is NOT added to liveWeight.
      continue
    }
    const familyScore =
      eligible.reduce((sum, d) => sum + verdictPoints(d.verdict), 0) / eligible.length
    weightedSum += familyScore * familyWeights[family]
    liveWeight += familyWeights[family]
  }

  // Renormalize by the weight that actually participated; no live family ⇒ 0 (nothing to score).
  return liveWeight > 0 ? weightedSum / liveWeight : 0
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute the two-tier conformance verdict.
 *
 * @param dimensions - All dimension entries for the project.
 * @param thresholds - Scoring thresholds (tier1Members, familyWeights, goldTier2Gate).
 * @param ratchetOk - True when the ratchet check has passed (score did not regress).
 */
export function computeConformance(
  dimensions: DimensionEntry[],
  thresholds: ConformanceThresholds,
  ratchetOk = false,
): TwoTierResult {
  // Tier-1 gate: any STRUCTURALLY tier-1 dim (or one explicitly listed in tier1Members)
  // with verdict N OR P → NON-CONFORMANT. #1658: keying solely on the hand-maintained
  // tier1Members allow-list left 4 structurally-tier-1 dims (D-COVERAGE-THRESHOLDS,
  // D-COMMIT-HYGIENE, D-INVARIANTS-ENFORCED, DISC-finding-hygiene) in a dead zone —
  // excluded from BOTH the gate and the tier-2 score (which filters tier === 2), so a
  // repo could read GOLD with coverage < 80% failing. P is non-pass: a partial on a
  // must-pass dimension is not a pass.
  // This IS anti-fake-green guard #8 (outcome-axis veto, #1412): a reality-contact Tier-1
  // dimension (e.g. D-LIVE-E2E) that is N vetoes the whole score to 0 — a high process
  // score cannot mask a missing outcome signal. The equivalence is documented in
  // docs/REFERENCE/anti-fake-green.md so the guard family stays honest about what ships.
  const tier1Fails = dimensions.filter(
    (d) =>
      (d.tier === 1 || thresholds.tier1Members.includes(d.id)) &&
      (d.verdict === 'N' || d.verdict === 'P'),
  )
  if (tier1Fails.length > 0) {
    return { verdict: 'NON-CONFORMANT', tier1Fails, score: 0, ratchetOk }
  }

  // Tier-2 score: family-weighted over non-tier-1 dims
  const tier2Dims = dimensions.filter((d) => d.tier === 2)
  const score = computeTier2Score(tier2Dims, thresholds.familyWeights)

  // Gold predicate: no T1 failures + score ≥ gate + ratchetOk
  const verdict: TwoTierResult['verdict'] =
    ratchetOk && score >= thresholds.goldTier2Gate ? 'GOLD' : 'CONFORMANT'

  return { verdict, tier1Fails: [], score, ratchetOk }
}
