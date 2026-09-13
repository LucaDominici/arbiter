#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — suppression rationale quality check (INV-89)
// Validates that all suppression entries have meaningful rationale (reason field).
// Extends check-suppressions.mjs which checks expiry — this checks reason quality.
// Exits 0 when all rationales are meaningful; exits 1 when thin rationales found.
// Part of the anti-drift validator family (W6).
//
// Usage: node scripts/check-suppression-rationale.mjs [--dir <path>] [--help]

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    [
      'Usage: node scripts/check-suppression-rationale.mjs [options]',
      '',
      'Validates that all suppression entries have meaningful rationale (reason field >= 20 chars).',
      'Exits 0 when all rationales are meaningful; exits 1 when thin rationales found.',
      '',
      'Options:',
      '  --dir <path>    Root directory to scan (default: cwd)',
      '  --help, -h      Show this help and exit',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

// #2675 Codex round-1: a bare or dangling --dir must never be read as "use the default" — a
// caller asking for an explicit scan root that cannot be honored would otherwise silently fall
// through to this gate's own fixture-less SKIP paths and report clean on the LIVE repo instead.
const dirArg = args.lastIndexOf('--dir')
let CWD = process.cwd()
if (dirArg >= 0) {
  const dirValue = args[dirArg + 1]
  if (dirValue === undefined || dirValue === '') {
    process.stderr.write('check-suppression-rationale: --dir requires a path argument\n')
    process.exit(2)
  }
  CWD = resolve(dirValue)
  if (!existsSync(CWD) || !statSync(CWD).isDirectory()) {
    process.stderr.write(
      `check-suppression-rationale: --dir ${dirValue} does not exist or is not a directory\n`,
    )
    process.exit(2)
  }
}
const SUPPRESSIONS_DIR = join(CWD, 'suppressions')

const REASON_MIN_LEN = 20
let violations = 0
let checked = 0

function checkJsonFile(filePath) {
  if (!existsSync(filePath)) return
  let data
  try {
    data = JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch (err) {
    if (err instanceof SyntaxError) {
      process.stderr.write(`[FAIL] ${filePath}: invalid JSON — ${err.message}\n`)
      violations++
      return
    }
    return
  }
  if (!Array.isArray(data)) return

  for (const entry of data) {
    checked++
    const reason = typeof entry.reason === 'string' ? entry.reason : ''
    if (reason.trim().length < REASON_MIN_LEN) {
      process.stderr.write(
        `[FAIL] ${filePath}: entry "${JSON.stringify(entry).slice(0, 60)}..." has thin reason: "${reason}" (min ${REASON_MIN_LEN} chars)\n`,
      )
      violations++
    }
  }
}

if (!existsSync(SUPPRESSIONS_DIR)) {
  process.stdout.write('check-suppression-rationale: SKIP — no suppressions/ directory\n')
  // #2052: recognized marker so runCheck surfaces SKIP, not PASS, in the gate summary.
  process.stdout.write('[SKIP] no suppressions/ directory\n')
  process.exit(0)
}

checkJsonFile(join(SUPPRESSIONS_DIR, 'pii-allowlist.json'))
checkJsonFile(join(SUPPRESSIONS_DIR, 'inline-suppressions.json'))
checkJsonFile(join(SUPPRESSIONS_DIR, 'consumer-audit-allowlist.json'))

if (violations > 0) {
  process.stderr.write(
    `check-suppression-rationale: FAIL — ${violations}/${checked} suppression(s) have thin rationale (INV-89)\n`,
  )
  process.exit(1)
}
process.stdout.write(
  `check-suppression-rationale: OK — all ${checked} suppression(s) have adequate rationale (INV-89)\n`,
)
process.exit(0)
