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
//
// #2453: `update`'s `--no-adopt-gate-spine` / `--no-adopt-governance` were
// permanent no-ops living OUTSIDE this registry — accepted by commander
// (custom no-op parsers), doing nothing, with no warning and no removal
// window. They are obsolete rather than fixable: #2119/#2141 flipped the
// default to withhold, so the behavior a negation would opt into ("withhold")
// is already unconditional — there is nothing left for `--no-adopt-*` to
// negate. Deprecated (not made to "work") for that reason; see
// docs/DEPRECATIONS.md CLI Flag Lifecycle for the two positive counterparts
// (`--adopt-gate-spine` / `--adopt-governance`), which remain live opt-ins.
export const CLI_DEPRECATED_FLAGS: readonly DeprecatedFlagRecord[] = [
  {
    flag: '--no-adopt-gate-spine',
    stage: 'warn',
    deprecatedIn: '0.5.0',
    removeIn: '0.8.0',
    replacement: '(none — omit the flag; withholding the gate spine is already the default)',
  },
  {
    flag: '--no-adopt-governance',
    stage: 'warn',
    deprecatedIn: '0.5.0',
    removeIn: '0.8.0',
    replacement: '(none — omit the flag; withholding governance files is already the default)',
  },
]
