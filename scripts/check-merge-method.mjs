#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: INV-101 enforcement. Verifies that the ff-only merge policy flags are present
// CATALOG: in both the self-script (scripts/apply-branch-protection.mjs) and the EJS
// CATALOG: template (src/templates/scripts/apply-branch-protection.mjs.ejs).
// CATALOG: rejected fold-in into check-collab-mode-wired.mjs (distinct concern: schema vs. cross-file merge policy scan per INV-94).
// CATALOG: rejected fold-in into check-self-dogfood.mjs (different concern: merge flags vs. dogfood parity).
// Usage: node scripts/check-merge-method.mjs [--config=<path>]

import { readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

const VALUE_PATTERNS = {
  allow_squash_merge: /allow_squash_merge\s*[=:]\s*false/,
  allow_rebase_merge: /allow_rebase_merge\s*[=:]\s*false/,
  required_linear_history: /required_linear_history\s*[=:]\s*true/,
}

function resolveConfigPath(args) {
  const flag = args.find((a) => a.startsWith('--config='))
  if (flag) return resolve(flag.slice('--config='.length))
  return resolve(process.cwd(), 'arbiter.json')
}

function checkFileForFlags(filePath, label) {
  if (!existsSync(filePath)) return [] // file absent → skip (not enforced in this project)
  const content = readFileSync(filePath, 'utf-8')
  const missing = Object.entries(VALUE_PATTERNS)
    .filter(([, pattern]) => !pattern.test(content))
    .map(([flag]) => flag)
  return missing.map(
    (flag) => `[INV-101] ${label} missing ff-only flag '${flag}' with correct value in ${filePath}`,
  )
}

try {
  const configPath = resolveConfigPath(process.argv.slice(2))
  const cwd = resolve(process.cwd())

  if (!existsSync(configPath)) {
    process.exit(0) // not an arbiter project — skip
  }

  const errors = [
    ...checkFileForFlags(join(cwd, 'scripts', 'apply-branch-protection.mjs'), 'self-script'),
    ...checkFileForFlags(
      join(cwd, 'src', 'templates', 'scripts', 'apply-branch-protection.mjs.ejs'),
      'EJS template',
    ),
  ]

  if (errors.length > 0) {
    for (const err of errors) {
      process.stderr.write(`${err}\n`)
    }
    process.stderr.write(
      `[INV-101] ff-only merge enforcement incomplete: allow_squash_merge:false, allow_rebase_merge:false, required_linear_history:true must be present in both scripts/apply-branch-protection.mjs and the EJS template.\n`,
    )
    process.exit(1)
  }

  process.stdout.write('ff-only merge flags present in self-script and template\n')
  process.exit(0)
} catch (err) {
  process.stderr.write(
    `[INV-101] Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(1)
}
