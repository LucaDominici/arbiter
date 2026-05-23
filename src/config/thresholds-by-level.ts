// SPDX-License-Identifier: Apache-2.0
import type { GovernanceLevel } from '../wizard/types.js'

/** Severity level for container image scans. */
export type ContainerScanSeverity = 'warn' | 'high-critical' | 'medium-plus'

/** Severity floor for SAST finding failures. */
export type SastGating = 'warn' | 'high-plus' | 'medium-plus'

/** SLSA build level target for release tier. */
export type SlsaTarget = 'L1' | 'L2' | 'L3'

/** Lint enforcement posture. */
export type LintPosture = 'warn' | 'zero-tolerance' | 'zero-pedantic'

/** Mutation gating posture. */
export type MutationGating = 'informational' | 'blocking'

/** Action ref pinning requirement. */
export type ActionPinning = 'tag-ok' | 'sha-required' | 'sha-renovate-gated'

/** Full set of CI tier thresholds that vary by governance level. */
export interface CiThresholdPack {
  /** Minimum line/statement coverage percentage (T1 blocking). */
  coverageLine: number
  /** Minimum branch coverage percentage (T1 blocking). */
  coverageBranch: number
  /** Mutation gating posture and blocking threshold (T3; nightly tracks). */
  mutation: { gating: MutationGating; threshold: number }
  /** CVSS score floor that causes dep-CVE gate to fail (T1 + T4). */
  cvssGateMin: number
  /** Container scan severity: which findings block the workflow (T2). */
  containerScan: ContainerScanSeverity
  /** SAST gating posture (T1 + T2). */
  sast: SastGating
  /** SLSA build level target for release tier (T3). */
  slsaTarget: SlsaTarget
  /** Lint enforcement posture across all stacks. */
  lint: LintPosture
  /** Whether cross-stack-guard is a hard-fail (vs warn). */
  crossStackGuardHard: boolean
  /** Whether debt-ratchet requires improvement (vs track/warn). */
  debtRatchetRequireImprovement: boolean
  /** Action ref pinning requirement. */
  actionPinning: ActionPinning
  /** Whether CODEOWNER review is required on top of human-approval gate. */
  codeownerRequired: boolean
}

const L1: CiThresholdPack = {
  coverageLine: 70,
  coverageBranch: 60,
  mutation: { gating: 'informational', threshold: 0 },
  cvssGateMin: 9.0,
  containerScan: 'warn',
  sast: 'warn',
  slsaTarget: 'L1',
  lint: 'warn',
  crossStackGuardHard: false,
  debtRatchetRequireImprovement: false,
  actionPinning: 'tag-ok',
  codeownerRequired: false,
}

const L2: CiThresholdPack = {
  coverageLine: 80,
  coverageBranch: 70,
  mutation: { gating: 'blocking', threshold: 75 },
  cvssGateMin: 7.0,
  containerScan: 'high-critical',
  sast: 'high-plus',
  slsaTarget: 'L2',
  lint: 'zero-tolerance',
  crossStackGuardHard: true,
  debtRatchetRequireImprovement: false,
  actionPinning: 'sha-required',
  codeownerRequired: false,
}

const L3: CiThresholdPack = {
  coverageLine: 85,
  coverageBranch: 80,
  mutation: { gating: 'blocking', threshold: 80 },
  cvssGateMin: 4.0,
  containerScan: 'medium-plus',
  sast: 'medium-plus',
  slsaTarget: 'L3',
  lint: 'zero-pedantic',
  crossStackGuardHard: true,
  debtRatchetRequireImprovement: true,
  actionPinning: 'sha-renovate-gated',
  codeownerRequired: true,
}

const L4: CiThresholdPack = {
  coverageLine: 90,
  coverageBranch: 85,
  mutation: { gating: 'blocking', threshold: 85 },
  cvssGateMin: 0.0,
  containerScan: 'medium-plus',
  sast: 'medium-plus',
  slsaTarget: 'L3',
  lint: 'zero-pedantic',
  crossStackGuardHard: true,
  debtRatchetRequireImprovement: true,
  actionPinning: 'sha-renovate-gated',
  codeownerRequired: true,
}

const PACKS: Record<GovernanceLevel, CiThresholdPack> = { L1, L2, L3, L4 }

export function getCiThresholds(level: GovernanceLevel): CiThresholdPack {
  return PACKS[level]
}
