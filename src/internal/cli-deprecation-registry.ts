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
//
// A4 (wave1 action plan): ship --batch (ADR-103, #1873) reached its removeIn
// (0.6.0) and was deleted outright (src/batch/, cli.ts wiring) rather than
// transitioned through the hide/remove stages — see docs/DEPRECATIONS.md
// Closed/Removed table.
export const CLI_DEPRECATED_FLAGS: readonly DeprecatedFlagRecord[] = []
