#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: ADR-106 / #1966 enforcement — codex-track parity contract. Bakes a pinned
// CATALOG:   fixture project with BOTH tracks via the real CLI (`init`), scans the track
// CATALOG:   roots (independent denominator), classifies every emitted file into exactly one
// CATALOG:   parity class (DERIVED / ALLOWLISTED / BY-DESIGN-EXCLUSIVE), verifies derived
// CATALOG:   files against the canonical Claude source AND committed goldens, validates the
// CATALOG:   generated CODEX.md Known Limitations table against the actual hook inventory,
// CATALOG:   and ratchets per-track file identities against a merge-base baseline.
// CATALOG: Rejected fold-in into check-self-dogfood.mjs — that gate proves template ↔
// CATALOG:   materialized .claude/ identity for THIS repo's own dogfooding; this gate proves
// CATALOG:   cross-TRACK (claude ↔ codex) parity of generated output for any target. Different
// CATALOG:   axis (dogfood self-identity vs product track parity), different fixture surface.
//
// Usage:
//   node scripts/check-codex-parity.mjs                 # full run (bake + all checks)
//   node scripts/check-codex-parity.mjs --baked-dir <d> # test-only: skip bake, use a
//                                                       #   pre-baked tree (fixtures)
//   node scripts/check-codex-parity.mjs --update-baseline  # reseed the committed baseline
//   node scripts/check-codex-parity.mjs --help
//
// Exit codes (INV-53): 0=PASS, 1=FAIL (parity violation), 2=ERROR (config/environment,
// fail-closed — e.g. merge-base unresolvable in a shallow clone; see hardening 17).
//
// Runbook: docs/internal/METHOD/CODEX_PARITY_RUNBOOK.md
// Operator entry: website/problems/codex-parity.md

import { fileURLToPath } from 'node:url'
import { runParityCheck } from './lib/codex-parity-lib.mjs'

const HELP = `Usage: node scripts/check-codex-parity.mjs [options]

Codex-track parity contract gate (ADR-106, #1966).

Options:
  --baked-dir <dir>   Use a pre-baked project tree instead of baking (tests only)
  --update-baseline   Rewrite scripts/data/codex-parity-baseline.json from the current bake
  --help, -h          Show this help and exit

Exit codes: 0=PASS, 1=FAIL, 2=ERROR (fail-closed).
`

function parseArgs(argv) {
  const args = { bakedDir: undefined, updateBaseline: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') args.help = true
    else if (a === '--update-baseline') args.updateBaseline = true
    else if (a === '--baked-dir') args.bakedDir = argv[++i]
    else {
      process.stderr.write(`check-codex-parity: unknown argument ${a}\n${HELP}`)
      process.exit(2)
    }
  }
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(HELP)
    process.exit(0)
  }

  // Skeleton (#1966 harness): the bake + data wiring lands in the GREEN phase.
  // A --baked-dir tree can already be scanned so the RED-phase fixture exercises
  // the real entrypoint end to end.
  if (args.bakedDir === undefined) {
    process.stdout.write('check-codex-parity: skeleton (harness #1966) — no checks wired yet\n')
    process.exit(0)
  }

  const result = runParityCheck({ bakedDir: args.bakedDir })
  for (const f of result.findings) {
    process.stdout.write(`  [${f.kind}] ${f.file}: ${f.message}\n`)
  }
  process.stdout.write(
    `check-codex-parity: parity-surface: ${result.surface.classified}/${result.surface.total}\n`,
  )
  process.exit(result.status === 'PASS' ? 0 : 1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
