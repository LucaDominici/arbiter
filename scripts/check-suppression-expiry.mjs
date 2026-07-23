#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — suppression expiry window check (INV-89)
// Validates that no suppression entries have excessively far expiry dates (> 365 days).
// Complements check-suppressions.mjs (checks expired) by catching over-extended suppressions.
// Exits 0 when all expiries are within the window; exits 1 when window exceeded.
// Part of the anti-drift validator family (W6).
//
// Usage: node scripts/check-suppression-expiry.mjs [--max-days <N>] [--help]

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    [
      'Usage: node scripts/check-suppression-expiry.mjs [options]',
      '',
      'Validates that no suppression entries have excessively far expiry dates.',
      'Exits 0 when all expiries are within the max window; exits 1 when exceeded.',
      '',
      'Options:',
      '  --max-days <N>  Maximum allowed days from now to expiry (default: 365)',
      '  --help, -h      Show this help and exit',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

const maxDaysArg = args.indexOf('--max-days')
const MAX_DAYS = maxDaysArg >= 0 && args[maxDaysArg + 1] ? parseInt(args[maxDaysArg + 1], 10) : 365

const CWD = process.cwd()
const SUPPRESSIONS_DIR = join(CWD, 'suppressions')

let violations = 0
let checked = 0

function checkJsonFile(filePath) {
  if (!existsSync(filePath)) return
  let data
  try {
    data = JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return
  }
  if (!Array.isArray(data)) return

  const now = new Date()
  for (const entry of data) {
    const expiresAt = entry.expiresAt ?? entry.until
    if (!expiresAt) continue
    checked++
    const expiry = new Date(expiresAt)
    if (isNaN(expiry.getTime())) continue
    const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    if (diffDays > MAX_DAYS) {
      process.stderr.write(
        `[FAIL] ${filePath}: entry expires in ${diffDays} day(s) (>${MAX_DAYS} max): ${expiresAt}\n`,
      )
      violations++
    }
  }
}

if (!existsSync(SUPPRESSIONS_DIR)) {
  process.stdout.write('check-suppression-expiry: SKIP — no suppressions/ directory\n')
  // #2052: recognized marker so runCheck surfaces SKIP, not PASS, in the gate summary.
  process.stdout.write('[SKIP] no suppressions/ directory\n')
  process.exit(0)
}

checkJsonFile(join(SUPPRESSIONS_DIR, 'pii-allowlist.json'))
checkJsonFile(join(SUPPRESSIONS_DIR, 'inline-suppressions.json'))
checkJsonFile(join(SUPPRESSIONS_DIR, 'consumer-audit-allowlist.json'))

if (violations > 0) {
  process.stderr.write(
    `check-suppression-expiry: FAIL — ${violations}/${checked} suppression(s) exceed ${MAX_DAYS}-day expiry window (INV-89)\n`,
  )
  process.exit(1)
}
process.stdout.write(
  `check-suppression-expiry: OK — all ${checked} suppression(s) within ${MAX_DAYS}-day expiry window (INV-89)\n`,
)
process.exit(0)
