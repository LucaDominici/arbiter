#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: anti-fake-green #6 (skip-critical-e2e, #1412). A critical-path end-to-end test that is
// CATALOG:   skipped is a falso-green: the highest-value reality-contact signal goes green without
// CATALOG:   ever running. Scans playwright/e2e spec dirs for skipped specs (test.skip/it.skip/
// CATALOG:   xtest/.fixme), and treats a skip on a spec tagged @critical-path as the worst case.
// CATALOG:   If NO e2e config is present the verdict is NA (exit 0) — there is nothing to skip, so
// CATALOG:   never a manufactured fail (distinct from guard #1's NO-DATA-on-unit-tests handling).
// CATALOG: Rejected fold-in into check-muted-test.mjs (#1): that is the unit/gate-test muted guard
// CATALOG:   over ALL test dirs with NO-DATA-fail-closed; this is the e2e-only critical-path guard
// CATALOG:   gated on an e2e config existing (NA, not SKIP, when absent). Different applicability
// CATALOG:   model (NA vs NO-DATA) and different scope (e2e specs vs all gate tests).
// selfOnly: arbiter-repo-only for now; downstream consumer-project gen DEFERRED to #1419 (LU-1).
// Exit codes per INV-53: 0=PASS / NA (no e2e config), 1=FAIL (skipped e2e spec), 2=ERROR.
// Usage: node scripts/check-skip-critical-e2e.mjs [--dir <path>] [--help]
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { walkRepo } from './lib/glob-walk.mjs'

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    'Usage: node scripts/check-skip-critical-e2e.mjs [--dir <path>]\n' +
      '  Fails when a critical-path e2e spec is skipped. If no e2e config exists → NA (exit 0).\n',
  )
  process.exit(0)
}
const dirArgIdx = args.indexOf('--dir')
const ROOT = dirArgIdx >= 0 && args[dirArgIdx + 1] ? resolve(args[dirArgIdx + 1]) : process.cwd()

// e2e config signals — if none exists, there is no e2e surface to skip (verdict NA).
const E2E_CONFIG_FILES = [
  'playwright.config.ts',
  'playwright.config.js',
  'playwright.config.mjs',
  'cypress.config.ts',
  'cypress.config.js',
  'cypress.config.mjs',
  'wdio.conf.ts',
  'wdio.conf.js',
]

// Directory names that conventionally hold e2e specs.
const E2E_DIR_NAMES = new Set(['e2e', 'playwright', 'cypress', 'integration-e2e'])

const SPEC_RE = /\.(?:spec|test|e2e)\.(?:ts|tsx|js|jsx|mjs)$/

// Skip markers anchored to statement start (a string mention is not a skip).
const SKIP_RE =
  /^(?:await\s+)?(?:test|it|describe)\.(?:skip|fixme)\s*\(|^x(?:test|it|describe)\s*\(/
const CRITICAL_RE = /@critical-path\b/
const EXEMPT_RE = /skip-critical-e2e-exempt:\s*\S/

function hasE2eConfig() {
  return E2E_CONFIG_FILES.some((f) => existsSync(join(ROOT, f)))
}

/** A file sits in an e2e tree if any ancestor dir (relative to ROOT) is an E2E_DIR_NAMES name. */
function inE2eTree(rel) {
  const segs = rel.split('/')
  segs.pop() // drop the filename — only ancestor dirs gate the e2e tree
  return segs.some((s) => E2E_DIR_NAMES.has(s))
}

/**
 * Collect spec files that live under an e2e-named directory, via the shared cycle-safe walker
 * (#1521). walkRepo's SKIP_DIRS already prune node_modules/.git/dist/build/coverage/.coverage.
 */
function collectE2eSpecs(root) {
  const acc = []
  for (const rel of walkRepo(root)) {
    const name = rel.slice(rel.lastIndexOf('/') + 1)
    if (inE2eTree(rel) && SPEC_RE.test(name)) acc.push(join(root, rel))
  }
  return acc
}

function main() {
  if (!hasE2eConfig()) {
    process.stdout.write('check-skip-critical-e2e: NA — no e2e config (playwright/cypress/wdio)\n')
    return 0
  }

  const specs = collectE2eSpecs(ROOT)

  const violations = []
  for (const file of specs) {
    let content
    try {
      content = readFileSync(file, 'utf-8')
    } catch {
      continue
    }
    const lines = content.split('\n')
    // A spec file is "critical-path" if any line carries the tag (annotation or title token).
    const fileCritical = lines.some((l) => CRITICAL_RE.test(l))
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim()
      const prev = i > 0 ? lines[i - 1] : ''
      if (EXEMPT_RE.test(lines[i]) || EXEMPT_RE.test(prev)) continue
      if (SKIP_RE.test(trimmed)) {
        const crit = fileCritical || CRITICAL_RE.test(trimmed) || CRITICAL_RE.test(prev)
        violations.push(`  ${file}:${i + 1}${crit ? ' [@critical-path]' : ''}: ${trimmed}`)
      }
    }
  }

  if (violations.length > 0) {
    process.stderr.write(
      `check-skip-critical-e2e: ${violations.length} skipped e2e spec(s) — a skipped e2e is a falso-green:\n`,
    )
    for (const v of violations) process.stderr.write(v + '\n')
    return 1
  }
  process.stdout.write(`check-skip-critical-e2e: OK — ${specs.length} e2e spec(s), none skipped\n`)
  return 0
}

try {
  process.exit(main())
} catch (e) {
  process.stderr.write(`check-skip-critical-e2e: ERROR — ${e?.message ?? e}\n`)
  process.exit(2)
}
