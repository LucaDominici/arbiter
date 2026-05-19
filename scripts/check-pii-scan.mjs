#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — PII scan patterns integrity checker (INV-89)
// Validates that the PII patterns data file exists and is well-formed.
// Distinct from pii-scan.mjs (which scans files); this validates the scanner config.
// Exits 0 when patterns file is valid; exits 1 when missing or malformed.
// Part of the anti-drift validator family (W6).
//
// Usage: node scripts/check-pii-scan.mjs [--patterns <path>] [--help]

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    [
      'Usage: node scripts/check-pii-scan.mjs [options]',
      '',
      'Validates that the PII patterns data file exists and is well-formed.',
      'Exits 0 when patterns file is valid; exits 1 when missing or malformed.',
      '',
      'Options:',
      '  --patterns <path>   Path to pii-patterns.txt (default: scripts/data/pii-patterns.txt)',
      '  --help, -h          Show this help and exit',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

const patternsArg = args.indexOf('--patterns')
const CWD = process.cwd()
const PATTERNS_PATH =
  patternsArg >= 0 && args[patternsArg + 1]
    ? resolve(args[patternsArg + 1])
    : join(CWD, 'scripts', 'data', 'pii-patterns.txt')

if (!existsSync(PATTERNS_PATH)) {
  process.stderr.write(
    `check-pii-scan: FAIL — PII patterns file missing: ${PATTERNS_PATH} (INV-89)\n`,
  )
  process.exit(1)
}

let content
try {
  content = readFileSync(PATTERNS_PATH, 'utf-8')
} catch (err) {
  process.stderr.write(`check-pii-scan: FAIL — cannot read ${PATTERNS_PATH}: ${String(err)}\n`)
  process.exit(1)
}

// Validate: non-empty, has at least one pattern line (not just comments)
const lines = content.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'))
if (lines.length === 0) {
  process.stderr.write(
    `check-pii-scan: FAIL — PII patterns file has no pattern entries: ${PATTERNS_PATH} (INV-89)\n`,
  )
  process.exit(1)
}

// Validate: each non-comment line is a valid regex
let violations = 0
for (const line of lines) {
  try {
    new RegExp(line.trim())
  } catch (err) {
    process.stderr.write(`[FAIL] invalid regex in ${PATTERNS_PATH}: "${line}" — ${String(err)}\n`)
    violations++
  }
}

if (violations > 0) {
  process.stderr.write(
    `check-pii-scan: FAIL — ${violations} invalid regex pattern(s) in ${PATTERNS_PATH} (INV-89)\n`,
  )
  process.exit(1)
}

process.stdout.write(
  `check-pii-scan: OK — PII patterns file valid: ${lines.length} pattern(s) in ${PATTERNS_PATH} (INV-89)\n`,
)
process.exit(0)
