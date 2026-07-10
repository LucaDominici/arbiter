// SPDX-License-Identifier: Apache-2.0
//
// #1839 (F3 friction cut): extracted from doctor.ts — the `arbiter doctor
// --prove-gates` subcommand (#1817, A5). Pure extraction, no behavior change.
import { jsonOutput } from '../../utils/json-output.js'
import { runGateProofs } from '../../conformance/gate-proofs.js'
import type { GateProofResult } from '../../conformance/gate-proofs.js'

// ── doctor --prove-gates (#1817, A5) ────────────────────────────────────────
//
// Anti-pattern observed on a reference project (handoff A5): ~40 `test-*.sh` scripts unit-testing
// the gate SCRIPTS themselves. Pattern that WORKED: `ArchNegativeProofTest` — one intentional-violation
// fixture per rule, proving the rule actually fails when violated. `--prove-gates` runs that
// pattern against every tier-1 (must-pass) conformance dimension arbiter installs: seed an
// isolated fixture that violates the rule, run the real probe, and report any gate whose
// negative fixture does NOT flip to a failing verdict — i.e. a gate that looks installed but
// does not bite. See src/conformance/gate-proofs.ts for the fixture registry.

export interface DoctorProveGatesOptions {
  json?: boolean
}

export interface DoctorProveGatesResult {
  exitCode: 0 | 1
  results: GateProofResult[]
  bitingCount: number
  notBitingCount: number
}

function emitProveGatesOutput(results: GateProofResult[]): void {
  process.stdout.write('\narbiter doctor --prove-gates — negative proof per tier-1 gate\n\n')
  for (const r of results) {
    const label = r.bites ? '[BITES]' : '[NO-BITE]'
    process.stdout.write(`  ${label} ${r.id} — ${r.title}\n`)
    process.stdout.write(`           violation: ${r.violation}\n`)
    process.stdout.write(`           verdict: ${r.verdict}${r.detail ? ` (${r.detail})` : ''}\n`)
  }
  process.stdout.write('\n')
}

/**
 * Run every registered gate proof (src/conformance/gate-proofs.ts) and report which tier-1
 * gates bite on their negative fixture and which do not. Exit code 1 when any gate fails to
 * bite — that is a gate installed in name only.
 */
export function runDoctorProveGates(opts: DoctorProveGatesOptions = {}): DoctorProveGatesResult {
  const results = runGateProofs()
  const bitingCount = results.filter((r) => r.bites).length
  const notBitingCount = results.length - bitingCount
  const exitCode: DoctorProveGatesResult['exitCode'] = notBitingCount > 0 ? 1 : 0

  if (opts.json) {
    jsonOutput('doctor --prove-gates', exitCode === 0 ? 'ok' : 'error', {
      results,
      bitingCount,
      notBitingCount,
    })
  } else {
    emitProveGatesOutput(results)
    if (notBitingCount > 0) {
      process.stdout.write(
        `${notBitingCount} of ${results.length} gate(s) did NOT bite on their negative fixture.\n\n`,
      )
    } else {
      process.stdout.write(`All ${results.length} tier-1 gates bite on their negative fixture.\n\n`)
    }
  }

  return { exitCode, results, bitingCount, notBitingCount }
}
