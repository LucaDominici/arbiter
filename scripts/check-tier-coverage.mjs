#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — CI tier coverage completeness check (INV-89)
// Validates that the check-all.mjs gate covers all expected tier checks.
// Exits 0 when tier coverage is complete; exits 1 when gaps are found.
// Part of the anti-drift validator family (W6).
//
// Usage: node scripts/check-tier-coverage.mjs [--gate <path>] [--help]

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    [
      'Usage: node scripts/check-tier-coverage.mjs [options]',
      '',
      'Validates that the check-all.mjs gate covers all expected tier checks.',
      'Exits 0 when tier coverage is complete; exits 1 when gaps are found.',
      '',
      'Options:',
      '  --gate <path>   Path to check-all.mjs (default: scripts/check-all.mjs)',
      '  --help, -h      Show this help and exit',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

const gateArg = args.indexOf('--gate')
const CWD = process.cwd()
const gatePath =
  gateArg >= 0 && args[gateArg + 1]
    ? resolve(args[gateArg + 1])
    : join(CWD, 'scripts', 'check-all.mjs')

// Required tier categories that must be wired in check-all.mjs
const REQUIRED_TIERS = [
  { name: 'build', pattern: /build-kit/ },
  { name: 'typecheck', pattern: /typecheck/ },
  { name: 'lint', pattern: /'lint'/ },
  { name: 'unit tests', pattern: /unit tests/ },
  { name: 'spdx headers', pattern: /spdx headers/ },
  { name: 'orphan TODOs', pattern: /orphan TODOs/ },
  { name: 'ci tiers', pattern: /ci tiers/ },
]

if (!existsSync(gatePath)) {
  process.stdout.write('check-tier-coverage: SKIP — check-all.mjs not found\n')
  process.exit(0)
}

const gateContent = readFileSync(gatePath, 'utf-8')
let violations = 0

for (const tier of REQUIRED_TIERS) {
  if (!tier.pattern.test(gateContent)) {
    process.stderr.write(`[FAIL] tier "${tier.name}" not found in check-all.mjs (INV-89)\n`)
    violations++
  }
}

if (violations > 0) {
  process.stderr.write(
    `check-tier-coverage: FAIL — ${violations}/${REQUIRED_TIERS.length} required tier(s) missing from gate (INV-89)\n`,
  )
  process.exit(1)
}
process.stdout.write(
  `check-tier-coverage: OK — all ${REQUIRED_TIERS.length} required tiers present in check-all.mjs (INV-89)\n`,
)
process.exit(0)
