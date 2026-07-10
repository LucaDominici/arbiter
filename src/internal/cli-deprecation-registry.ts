// SPDX-License-Identifier: Apache-2.0

type DeprecationStage = 'warn' | 'hide' | 'remove'

export interface DeprecatedFlagRecord {
  flag: string
  stage: DeprecationStage
  deprecatedIn: string
  removeIn: string
  replacement: string
}

// Single source of truth for deprecated CLI flags.
// Stage policy: each transition requires ≥1 MINOR version gap.
// warn  → print deprecation notice; flag still works.
// hide  → print notice + suppress flag from --help output.
// remove → reject with error pointing to replacement.
export const CLI_DEPRECATED_FLAGS: readonly DeprecatedFlagRecord[] = [
  // ADR-103 (#1873): ship --batch is the second multi-issue loop (ADR-093 disease).
  // /drain (wave-drain skill) is the canonical multi-issue entrypoint. The batch
  // seam (IssueRunner, runShipBatch) stays sync and untouched until removal.
  {
    flag: '--batch',
    stage: 'warn',
    deprecatedIn: '0.4.0',
    removeIn: '0.6.0',
    replacement: '/drain (wave-drain skill)',
  },
]
