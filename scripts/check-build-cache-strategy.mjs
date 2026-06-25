#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: C3 (#1497) — parametric build-cache composite action gate.
// CATALOG: Scans the build-cache composite action template and asserts the three
// CATALOG:   invariants that make the cross-job build cache safe:
// CATALOG:     1. Parametric — all four strategies are expressed in the template
// CATALOG:        (node-workspace | python-wheel | maven-reactor | gradle).
// CATALOG:     2. Immutable run-id key — the artifact name embeds github.run_id so
// CATALOG:        every job in a run shares one build with no cross-run collision.
// CATALOG:     3. Non-blocking rebuild fallback — `restore` never hard-fails on a
// CATALOG:        missing/expired artifact; it rebuilds the outputs locally.
// CATALOG: Cannot fold into check-workflow-cache-strategy.mjs (different input root:
// CATALOG:   that gate lints workflow templates for cache PRESENCE; this lints a
// CATALOG:   composite ACTION template for the parametric-strategy contract — ADR-090).
//
// Exit codes (INV-53): 0 PASS, 1 FAIL (violations), 2 ERROR (template missing).
//
// Usage: node scripts/check-build-cache-strategy.mjs [--dir <repo-root>] [--help]

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    [
      'Usage: node scripts/check-build-cache-strategy.mjs [options]',
      '',
      'Validates the parametric build-cache composite action template (C3).',
      'Asserts: all four strategies present, immutable run-id artifact key, and a',
      'non-blocking rebuild fallback on restore.',
      '',
      'Exits 0 when all checks pass; 1 on violations; 2 when the template is',
      'missing (fail-closed, INV-53).',
      '',
      'Options:',
      '  --dir <path>    Repo root to scan (default: cwd)',
      '  --help, -h      Show this help and exit',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

const dirArg = args.indexOf('--dir')
const CWD = dirArg >= 0 && args[dirArg + 1] ? resolve(args[dirArg + 1]) : process.cwd()

const ACTION_TPL = join(
  CWD,
  'src',
  'templates',
  'github',
  'actions',
  'build-cache',
  'action.yml.ejs',
)

// ─── Input-set guard (fail-closed, INV-53) ────────────────────────────────────

if (!existsSync(ACTION_TPL)) {
  process.stderr.write(
    'check-build-cache-strategy: ERROR — build-cache action template not found: ' +
      `${ACTION_TPL} (fail-closed, INV-53)\n`,
  )
  process.exit(2)
}

let content
try {
  content = readFileSync(ACTION_TPL, 'utf-8')
} catch (err) {
  process.stderr.write(
    `check-build-cache-strategy: ERROR — cannot read ${ACTION_TPL}: ${
      err instanceof Error ? err.message : String(err)
    }\n`,
  )
  process.exit(2)
}

// ─── Assertions ───────────────────────────────────────────────────────────────

const REQUIRED_STRATEGIES = ['node-workspace', 'python-wheel', 'maven-reactor', 'gradle']

/** @type {string[]} */
const violations = []

// 1. Parametric: every strategy identifier must be expressed in the template.
for (const strategy of REQUIRED_STRATEGIES) {
  if (!content.includes(strategy)) {
    violations.push(`missing build-cache strategy "${strategy}" (template is not parametric)`)
  }
}

// 2. Immutable run-id key: the artifact name must embed github.run_id. Tolerant of
//    interior whitespace inside the ${{ ... }} expression.
const runIdKey = /build-cache-[^\n]*?\$\{\{\s*github\.run_id\s*\}\}/
if (!runIdKey.test(content)) {
  violations.push(
    'no immutable run-id artifact key found ' +
      '(expected an artifact name of the form build-cache-<strategy>-${{ github.run_id }})',
  )
}

// 3. Non-blocking rebuild fallback. Three structural conditions must all hold:
//    (a) the restore download is guarded so a missing artifact never hard-fails
//        (the failure is swallowed, e.g. `2>/dev/null`, and a `restored` flag is set);
//    (b) a rebuild-fallback step exists; and
//    (c) that step is gated on the restore having NOT succeeded.
const restoreIsNonBlocking = content.includes('2>/dev/null') && /restored=false/.test(content)
if (!restoreIsNonBlocking) {
  violations.push(
    'restore step is not non-blocking ' +
      '(expected a swallowed download failure that sets restored=false on miss)',
  )
}

const hasRebuildFallback = /Rebuild fallback/i.test(content)
const fallbackGated =
  /steps\.[\w-]*restore[\w-]*\.outputs\.restored\s*!=\s*'true'/.test(content) ||
  /steps\.[\w-]*restore[\w-]*\.outputs\.restored\s*==\s*'false'/.test(content)
if (!hasRebuildFallback || !fallbackGated) {
  violations.push(
    'no gated rebuild fallback found ' +
      '(expected a "Rebuild fallback" step gated on the restore output != \'true\')',
  )
}

// ─── Result ───────────────────────────────────────────────────────────────────

if (violations.length > 0) {
  process.stderr.write(
    `check-build-cache-strategy: FAIL — ${violations.length} build-cache violation(s) found:\n`,
  )
  for (const v of violations) {
    process.stderr.write(`  [FAIL] ${v}\n`)
  }
  process.exit(1)
}

process.stdout.write(
  'check-build-cache-strategy: OK — parametric build-cache invariants satisfied ' +
    `(${REQUIRED_STRATEGIES.length} strategies, run-id key, non-blocking rebuild fallback; C3)\n`,
)
process.exit(0)
