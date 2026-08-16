#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: #2039 — reconciles src/commands/method.ts METHODOLOGY_CATALOG against
// CATALOG: src/commands/configure.ts ALLOWED_PATHS, in BOTH directions, so the feature
// CATALOG: lens can neither claim a path `configure --set` would reject nor silently
// CATALOG: stop covering a settable one.
// CATALOG: Rejected fold-in into check-settings-coverage.mjs: that gate asserts an exact
// CATALOG: two-way EQUALITY (settings is a total mirror of ALLOWED_PATHS). `method` is a
// CATALOG: LENS — it deliberately omits project-shape paths — so its second direction is
// CATALOG: "lensed OR explicitly excluded with a reason", a different rule that would have
// CATALOG: to be branched inside a shared script anyway.
// CATALOG: Rejected fold-in into check-command-tests.mjs: that gate is tests-per-command,
// CATALOG: not field coverage, and knows nothing about config paths.
//
// Why a build gate at all: the catalog is hand-authored content, and hand-authored content
// rots. Without this, a row bound to a path that no longer exists renders as a permanently
// "off" feature nobody can turn on, and a new settable path never reaches the lens at all —
// both of which read as a working tool reporting a false state.
//
// The three rules:
//   1. every catalog configPath is in ALLOWED_PATHS               (no unsettable rows)
//   2. every ALLOWED_PATH is lensed OR in NON_METHODOLOGY_PATHS   (no silent omissions)
//   3. no path appears in two catalog rows                        (one owner per dial)
//
// Fail-closed: an extraction that yields nothing means the source shape changed and the
// gate would otherwise pass vacuously — that is an ERROR, not a PASS.
//
// Usage: node scripts/check-methodology-coverage.mjs [--root <dir>]
// Exit codes (per INV-53): 0 PASS, 1 FAIL, 2 invocation / IO error.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** `ALLOWED_PATHS = new Set([ '...', ... ])` — the quoted entries. */
function allowedPaths(src) {
  const m = src.match(/ALLOWED_PATHS\s*=\s*new Set\(\[([\s\S]*?)\]\)/)
  if (!m) throw new Error('ALLOWED_PATHS not found in configure.ts')
  return new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]))
}

/** Catalog rows carry `configPaths: ['a', 'b']` — collect them per row so rule 3 can see
 *  duplicates across rows, which a flat set would silently absorb. */
function catalogPathRows(src) {
  const block = src.match(/METHODOLOGY_CATALOG[\s\S]*?\n\]/)
  if (!block) throw new Error('METHODOLOGY_CATALOG not found in method.ts')
  return [...block[0].matchAll(/configPaths:\s*\[([^\]]*)\]/g)].map((m) =>
    [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]),
  )
}

/** `NON_METHODOLOGY_PATHS = new Map([ ['path', 'reason'], ... ])` — path => reason. */
function excludedPaths(src) {
  const block = src.match(/NON_METHODOLOGY_PATHS[\s\S]*?\n\]\)/)
  if (!block) throw new Error('NON_METHODOLOGY_PATHS not found in method.ts')
  const out = new Map()
  for (const m of block[0].matchAll(/\[\s*'([^']+)'\s*,\s*'([^']*)'/g)) out.set(m[1], m[2])
  return out
}

/** Rule 3: one dial, one owner. Returns the flat path set the other rules work from. */
function bindingsAndDuplicates(rows, violations) {
  const seen = new Set()
  for (const row of rows) {
    for (const p of row) {
      if (seen.has(p)) violations.push(`  DUPLICATE: '${p}' is bound by more than one catalog row`)
      seen.add(p)
    }
  }
  return seen
}

/** Rules 1 + 2 + the exclusion-ledger hygiene. Extracted from `main` to keep its
 *  cyclomatic complexity under the repo ceiling (CANON-22), same as
 *  check-no-direct-fs.mjs's `checkFile`. */
function collectViolations(allowed, rows, excluded) {
  const violations = []
  const seen = bindingsAndDuplicates(rows, violations)

  for (const p of [...seen].filter((x) => !allowed.has(x)).sort()) {
    violations.push(
      `  NOT SETTABLE: catalog binds '${p}', which is not in configure.ts ALLOWED_PATHS — ` +
        `the lens would render a feature nobody can turn on`,
    )
  }

  for (const p of [...allowed].filter((x) => !seen.has(x) && !excluded.has(x)).sort()) {
    violations.push(
      `  UNLENSED: '${p}' is settable but appears in no catalog row — add a row, or add it ` +
        `to NON_METHODOLOGY_PATHS in method.ts with a reason`,
    )
  }

  // A stale exclusion is a bypass: it pre-approves omitting a path that no longer exists.
  for (const p of [...excluded.keys()].filter((x) => !allowed.has(x)).sort()) {
    violations.push(`  STALE EXCLUSION: '${p}' is excluded but is not an ALLOWED_PATH — remove it`)
  }
  for (const [p, reason] of excluded) {
    if (reason.trim() === '')
      violations.push(`  ${p}: exclusion has no reason — a bare path explains nothing`)
  }

  return { seen, violations }
}

function main() {
  const rootIdx = process.argv.indexOf('--root')
  const root = resolve(rootIdx >= 0 && process.argv[rootIdx + 1] ? process.argv[rootIdx + 1] : '.')

  const configureSrc = readFileSync(resolve(root, 'src/commands/configure.ts'), 'utf-8')
  const methodSrc = readFileSync(resolve(root, 'src/commands/method.ts'), 'utf-8')

  const allowed = allowedPaths(configureSrc)
  const rows = catalogPathRows(methodSrc)
  const excluded = excludedPaths(methodSrc)

  if (allowed.size === 0) throw new Error('extracted zero ALLOWED_PATHS — parser out of date')
  if (rows.length === 0) throw new Error('extracted zero catalog rows — parser out of date')

  const { seen, violations } = collectViolations(allowed, rows, excluded)

  if (violations.length > 0) {
    process.stdout.write(
      `[check-methodology-coverage] FAIL: ${violations.length} drift(s) between ` +
        `METHODOLOGY_CATALOG and ALLOWED_PATHS\n`,
    )
    for (const v of violations) process.stdout.write(v + '\n')
    process.exit(1)
  }
  process.stdout.write(
    `[check-methodology-coverage] OK — ${rows.length} feature row(s) covering ${seen.size} of ` +
      `${allowed.size} settable paths, ${excluded.size} excluded with a reason\n`,
  )
}

try {
  main()
} catch (err) {
  process.stderr.write(
    `[check-methodology-coverage] ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(2)
}
