// SPDX-License-Identifier: Apache-2.0
//
// `arbiter doctor` commands (#619, #539, #618, #1217, #1817).
//
// #1839 (F3 friction cut): split into src/commands/doctor/*.ts by subcommand (was
// ~1093 LOC / 5 mixed subcommands in this one file). This file is now a pure
// re-export barrel — every symbol actually consumed outside doctor.ts is
// re-exported below so no external import path changes. The per-subcommand
// Options/Result interfaces are NOT re-exported here: nothing outside doctor.ts
// ever imported them by name (only structurally, via the run* function
// signatures), and re-exporting an otherwise-unconsumed type name trips the
// dead-code gate (knip) — they stay exported directly from their home module for
// any future same-file/local consumer.
// Pure extraction, no behavior change.
//
// - `health`: Checks Node version, git, hooks path, and AGENTS.md presence.
// - `repair-state`: Re-derives `.arbiter-generated.json` from `arbiter.json`.
// - `recover-lock`: Force-releases a stale `.arbiter/.lock` file.
// - `clean`: Removes stray backup files.
// - `--prove-gates`: Runs negative proofs for every tier-1 conformance gate (#1817, A5).
// - `tool-pins`: Local toolchain vs CI workflow version pins (#2162).
// - `fail-open-census`: Census of `command -v X || <fail-open>` gate scripts (#2162).
export { runDoctorHealth } from './doctor/health.js'
export type { HealthCheck } from './doctor/health.js'
export { runDoctorRepairState } from './doctor/repair-state.js'
export { runDoctorRecoverLock } from './doctor/recover-lock.js'
export { runDoctorClean } from './doctor/clean.js'
export { runDoctorProveGates } from './doctor/prove-gates.js'
export { runDoctorToolPins } from './doctor/tool-pins.js'
export { runDoctorFailOpenCensus } from './doctor/fail-open-census.js'
