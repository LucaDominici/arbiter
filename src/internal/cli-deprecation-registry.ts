// SPDX-License-Identifier: Apache-2.0

export type DeprecationStage = 'warn' | 'hide' | 'remove'

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
export const CLI_DEPRECATED_FLAGS: readonly DeprecatedFlagRecord[] = []
