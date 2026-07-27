#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: INV-101 enforcement for the exact-SHA landing contract.
// CATALOG: validates the canonical policy plus applicator and watcher wiring.
// CATALOG: rejected fold-in because merge mutation safety is independent of config schema checks.
// Usage: node scripts/check-merge-method.mjs [--config=<path>]

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const POLICY_PATTERNS = {
  allow_merge_commit: /allow_merge_commit\s*:\s*true/,
  allow_squash_merge: /allow_squash_merge\s*:\s*false/,
  allow_rebase_merge: /allow_rebase_merge\s*:\s*false/,
  required_linear_history: /required_linear_history\s*:\s*false/,
  allow_force_pushes: /allow_force_pushes\s*:\s*false/,
  allow_deletions: /allow_deletions\s*:\s*false/,
}
const WATCHER_REQUIRED = {
  updateRefs: /\bupdateRefs\b/,
  beforeOid: /\bbeforeOid\b/,
  afterOid: /\bafterOid\b/,
  non_force: /force\s*:\s*false/,
  live_policy: /\bvalidateLiveExactShaPolicy\b/,
}
const WATCHER_FORBIDDEN = {
  gh_pr_merge: /['"]pr['"]\s*,\s*['"]merge['"]|gh\s+pr\s+merge/,
  rebase: /--rebase/,
  squash: /--squash/,
}

function configPath(args) {
  const flag = args.find((arg) => arg.startsWith('--config='))
  return flag ? resolve(flag.slice('--config='.length)) : resolve('arbiter.json')
}

function requireFile(path, label, errors) {
  if (!existsSync(path)) {
    errors.push(`${label} missing: ${path}`)
    return ''
  }
  return readFileSync(path, 'utf8')
}

try {
  if (!existsSync(configPath(process.argv.slice(2)))) process.exit(0)
  const root = resolve()
  const errors = []
  const policy = requireFile(
    join(root, 'scripts/lib/exact-sha-policy.mjs'),
    'canonical policy',
    errors,
  )
  const watcher = requireFile(join(root, 'scripts/pr-merge-watch.mjs'), 'merge watcher', errors)
  const applicator = requireFile(
    join(root, 'scripts/apply-branch-protection.mjs'),
    'branch-protection applicator',
    errors,
  )

  for (const [name, pattern] of Object.entries(POLICY_PATTERNS)) {
    if (!pattern.test(policy)) errors.push(`canonical policy missing ${name} with exact value`)
  }
  for (const [name, pattern] of Object.entries(WATCHER_REQUIRED)) {
    if (!pattern.test(watcher)) errors.push(`merge watcher missing ${name} exact-SHA wiring`)
  }
  for (const [name, pattern] of Object.entries(WATCHER_FORBIDDEN)) {
    if (pattern.test(watcher)) errors.push(`merge watcher contains forbidden ${name} path`)
  }
  if (!/exact-sha-policy\.mjs/.test(applicator)) {
    errors.push('branch-protection applicator does not import the canonical policy')
  }

  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`[INV-101] ${error}\n`)
    process.exit(1)
  }
  process.stdout.write('exact-SHA landing policy and watcher wiring present\n')
  process.exit(0)
} catch (error) {
  process.stderr.write(
    `[INV-101] ERROR: ${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exit(2)
}
