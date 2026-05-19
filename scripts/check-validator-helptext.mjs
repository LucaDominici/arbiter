#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — validator --help text coverage check (INV-89)
// Validates that all W6 anti-drift check-*.mjs scripts support a --help flag.
// Exits 0 when all W6 validators have --help; exits 1 when any are missing it.
// Part of the anti-drift validator family (W6).
//
// Usage: node scripts/check-validator-helptext.mjs [--dir <path>] [--help]

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    [
      'Usage: node scripts/check-validator-helptext.mjs [options]',
      '',
      'Validates that all W6 anti-drift check-*.mjs scripts support a --help flag.',
      'Exits 0 when all W6 validators have --help; exits 1 when any are missing it.',
      '',
      'Options:',
      '  --dir <path>    Root directory to scan (default: cwd)',
      '  --help, -h      Show this help and exit',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

const dirArg = args.indexOf('--dir')
const CWD = dirArg >= 0 && args[dirArg + 1] ? resolve(args[dirArg + 1]) : process.cwd()

const SCRIPTS_DIR = join(CWD, 'scripts')

// W6 anti-drift validator family marker
const W6_MARKER = 'anti-drift validator family (W6)'

let violations = 0
let checked = 0

if (!existsSync(SCRIPTS_DIR)) {
  process.stdout.write('check-validator-helptext: SKIP — no scripts/ directory found\n')
  process.exit(0)
}

const entries = readdirSync(SCRIPTS_DIR, { withFileTypes: true })
for (const entry of entries) {
  if (!entry.isFile()) continue
  if (!entry.name.startsWith('check-') || !entry.name.endsWith('.mjs')) continue

  const fullPath = join(SCRIPTS_DIR, entry.name)
  let content
  try {
    content = readFileSync(fullPath, 'utf-8')
  } catch {
    continue
  }

  // Only check W6 anti-drift family scripts
  if (!content.includes(W6_MARKER)) continue

  checked++
  if (!content.includes('--help')) {
    process.stderr.write(`[FAIL] ${entry.name}: no --help flag support found (INV-89)\n`)
    violations++
  }
}

if (violations > 0) {
  process.stderr.write(
    `check-validator-helptext: FAIL — ${violations}/${checked} W6 validator(s) missing --help support (INV-89)\n`,
  )
  process.exit(1)
}
process.stdout.write(
  `check-validator-helptext: OK — all ${checked} W6 validators support --help (INV-89)\n`,
)
process.exit(0)
