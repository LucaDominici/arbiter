import type { GovernanceLevel, ThresholdProfile } from "../wizard/types.js";

export interface ThresholdSet {
  /** Whether to include a coverage gate in the generated check-all script. */
  coverageEnabled: boolean;
  /** Whether to include a mutation gate in the generated check-all script. */
  mutationEnabled: boolean;
  /** Line/statement coverage percentage to enforce. Only meaningful when coverageEnabled. */
  coverageThreshold: number;
  /** Mutation score percentage to enforce. Only meaningful when mutationEnabled. */
  mutationThreshold: number;
}

/**
 * Compute gating thresholds for a project.
 *
 * - fixed:  flat 80% (L2) / 85% (L3) regardless of project size.
 * - scaled: LoC-based ramp.
 *   · coverage disabled  < 1 000 LoC
 *   · mutation  disabled < 5 000 LoC
 *   · coverage threshold ramps 60% → 85% between 1k and 10k LoC
 *
 * @param linesOfCode  Detected LoC (0 = unknown, treated same as any value < 1k).
 * @param profile      "scaled" or "fixed".
 * @param governanceLevel  L1 | L2 | L3 — affects base threshold for fixed profile.
 */
export function computeThresholds(
  linesOfCode: number,
  profile: ThresholdProfile,
  governanceLevel: GovernanceLevel,
): ThresholdSet {
  const mutationThreshold = 85;

  if (profile === "fixed") {
    const coverageThreshold = governanceLevel === "L3" ? 85 : 80;
    return {
      coverageEnabled: true,
      mutationEnabled: true,
      coverageThreshold,
      mutationThreshold,
    };
  }

  // Scaled profile
  const coverageEnabled = linesOfCode >= 1_000;
  const mutationEnabled = linesOfCode >= 5_000;

  // Ramp: 60% at 1k LoC → 85% at 10k+ LoC (linear, clamped)
  let coverageThreshold: number;
  if (!coverageEnabled) {
    coverageThreshold = 60; // not used, but set a sensible default
  } else {
    const MIN_LOC = 1_000;
    const MAX_LOC = 10_000;
    const MIN_PCT = 60;
    const MAX_PCT = 85;
    const t = Math.min(1, (linesOfCode - MIN_LOC) / (MAX_LOC - MIN_LOC));
    coverageThreshold = Math.round(MIN_PCT + t * (MAX_PCT - MIN_PCT));
  }

  return {
    coverageEnabled,
    mutationEnabled,
    coverageThreshold,
    mutationThreshold,
  };
}
