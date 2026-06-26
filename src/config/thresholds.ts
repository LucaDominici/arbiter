// SPDX-License-Identifier: Apache-2.0
import { DEFAULT_THRESHOLDS } from './schema.js'
import type { GovernanceLevel, ThresholdProfile, ThresholdsV2 } from '../wizard/types.js'

export interface ThresholdSet {
  /** Whether to include a coverage gate in the generated check-all script. */
  coverageEnabled: boolean
  /** Whether to include a mutation gate in the generated check-all script. */
  mutationEnabled: boolean
  /** Line/statement coverage percentage to enforce. Only meaningful when coverageEnabled. */
  coverageThreshold: number
  /** Mutation score percentage to enforce. Only meaningful when mutationEnabled. */
  mutationThreshold: number
}

/**
 * Compute gating thresholds for a project.
 *
 * - fixed:  per-level floor taken straight from the single SSOT
 *   `DEFAULT_THRESHOLDS[level]` (L1 60 / L2 80 / L3·L4 85), regardless of size.
 * - scaled: LoC-based ramp.
 *   · coverage disabled  < 1 000 LoC
 *   · mutation  disabled < 5 000 LoC
 *   · coverage threshold ramps 60% → 85% between 1k and 10k LoC
 *
 * #1527: the fixed-profile coverage and the mutation floor are DERIVED from
 * `DEFAULT_THRESHOLDS` rather than re-hardcoded here, so the two former SSOTs
 * (this module + schema.ts) can no longer drift (they previously disagreed at
 * L1 line 60-vs-80 and L2 mutation 80-vs-85).
 *
 * @param linesOfCode  Detected LoC (0 = unknown, treated same as any value < 1k).
 * @param profile      "scaled" or "fixed".
 * @param governanceLevel  L1 | L2 | L3 | L4 — selects the per-level SSOT row.
 */
export function computeThresholds(
  linesOfCode: number,
  profile: ThresholdProfile,
  governanceLevel: GovernanceLevel,
): ThresholdSet {
  const levelDefaults = DEFAULT_THRESHOLDS[governanceLevel]
  const mutationThreshold = levelDefaults.mutationScore

  if (profile === 'fixed') {
    return {
      coverageEnabled: true,
      mutationEnabled: true,
      coverageThreshold: levelDefaults.lineCoverage,
      mutationThreshold,
    }
  }

  // Scaled profile
  const coverageEnabled = linesOfCode >= 1_000
  const mutationEnabled = linesOfCode >= 5_000

  // Ramp: 60% at 1k LoC → 85% at 10k+ LoC (linear, clamped)
  let coverageThreshold: number
  if (!coverageEnabled) {
    coverageThreshold = 60 // not used, but set a sensible default
  } else {
    const MIN_LOC = 1_000
    const MAX_LOC = 10_000
    const MIN_PCT = 60
    const MAX_PCT = 85
    const t = Math.min(1, (linesOfCode - MIN_LOC) / (MAX_LOC - MIN_LOC))
    coverageThreshold = Math.round(MIN_PCT + t * (MAX_PCT - MIN_PCT))
  }

  return {
    coverageEnabled,
    mutationEnabled,
    coverageThreshold,
    mutationThreshold,
  }
}

/** Resolved per-key coverage/mutation floors that every generator must agree on. */
export interface EffectiveThresholds {
  coverageEnabled: boolean
  mutationEnabled: boolean
  /** Line/statement/function coverage floor — the SAME number for all three keys. */
  lineCoverage: number
  /** Branch coverage floor. */
  branchCoverage: number
  /** Mutation score floor. */
  mutationScore: number
}

/** Minimal config shape needed to resolve thresholds (decoupled from ProjectConfig). */
interface ThresholdConfig {
  linesOfCode?: number
  thresholdProfile?: ThresholdProfile
  governanceLevel: GovernanceLevel
  thresholds?: ThresholdsV2
}

/**
 * #1527 — the SINGLE precedence rule for coverage/mutation floors, applied once
 * here and consumed identically by the check-all, coverage and mutation
 * generators. Before this existed each generator resolved thresholds its own way
 * (`?? computed`, straight-through `computeThresholds`, hardcoded `?? 85`),
 * which let the generated gate disagree with the generated tool config inside a
 * single project — even inside a single vitest.config.ts.
 *
 * Precedence:
 *  - **scaled** profile: the LoC ramp drives line coverage + mutation. The user
 *    opted into size-based scaling, so an auto-filled per-level default
 *    (`autoFillThresholds`) must NOT shadow the ramp — the previous bug that made
 *    the documented "scaled" profile inert for the actual gate (#88 regression).
 *  - **fixed** profile (default): an explicit `config.thresholds` value wins over
 *    the computed per-level default via `??` — `??` not `||` so an explicit `0`
 *    floor is honoured (#484). Because `computeThresholds(fixed)` now derives from
 *    the same `DEFAULT_THRESHOLDS` SSOT, the auto-filled default and the computed
 *    fallback are identical, so the two paths agree by construction.
 *
 * Branch coverage and the non-coverage gates (complexity/length/params) always
 * come from `config.thresholds` (the per-level SSOT or the user override); the
 * scaled ramp only governs line coverage + mutation.
 */
export function resolveEffectiveThresholds(config: ThresholdConfig): EffectiveThresholds {
  const profile = config.thresholdProfile ?? 'fixed'
  const computed = computeThresholds(config.linesOfCode ?? 0, profile, config.governanceLevel)
  const defaults = DEFAULT_THRESHOLDS[config.governanceLevel]

  const lineCoverage =
    profile === 'scaled'
      ? computed.coverageThreshold
      : (config.thresholds?.lineCoverage ?? computed.coverageThreshold)
  const mutationScore =
    profile === 'scaled'
      ? computed.mutationThreshold
      : (config.thresholds?.mutationScore ?? computed.mutationThreshold)
  const branchCoverage = config.thresholds?.branchCoverage ?? defaults.branchCoverage

  return {
    coverageEnabled: computed.coverageEnabled,
    mutationEnabled: computed.mutationEnabled,
    lineCoverage,
    branchCoverage,
    mutationScore,
  }
}
