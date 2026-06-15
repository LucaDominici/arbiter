// SPDX-License-Identifier: Apache-2.0
// conformance/score.ts — Two-tier conjunctive conformance scoring (#1394/C2 of #1369).
//
// Tier-1 gate: any N on a Tier-1 dimension → NON-CONFORMANT regardless of Tier-2.
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
 * Compute weighted T2 score across the four quality families.
 * NA/NV dims are excluded from family denominators.
 * Families with no eligible dims contribute 0 to the weighted sum
 * but their weight still divides the total.
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

  for (const family of families) {
    const inFamily = tier2Dims.filter((d) => d.family === family)
    const eligible = inFamily.filter((d) => !isExcluded(d.verdict))
    if (eligible.length === 0) {
      // No eligible dims → family score = 0, still contributes 0 weighted
      continue
    }
    const familyScore =
      eligible.reduce((sum, d) => sum + verdictPoints(d.verdict), 0) / eligible.length
    weightedSum += familyScore * familyWeights[family]
  }

  return weightedSum
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
  // Tier-1 gate: any dim in tier1Members with verdict N → NON-CONFORMANT
  const tier1Fails = dimensions.filter(
    (d) => thresholds.tier1Members.includes(d.id) && d.verdict === 'N',
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
