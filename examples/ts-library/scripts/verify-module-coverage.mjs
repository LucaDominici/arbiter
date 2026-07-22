#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// ts-library-fixture — per-MODULE coverage non-regression ratchet (#1457, INV-134).
//
// ADVISORY (L2, start-warn): complements — does NOT duplicate — the FE per-layer
// coverage ratchet (verify-fe-coverage.mjs, FSD layers, frontend-only) and the
// total-coverage greenfield gate (lib/coverage-gate.mjs). This gate is per-FILE /
// per-package, all-languages, upward-only with a ±SLACK pp tolerance: a module whose
// coverage drops more than SLACK below module-coverage-baseline.json is a regression.
//
// Greenfield-aware: a module with zero executable lines contributes nothing (a virgin
// or generated-only file must never false-fail). First run with coverage present and
// no baseline seeds the baseline and exits 0. No coverage artifact at all → SKIP
// (exit 0) — non-coverage repos and pre-coverage CI stages never false-fail.
//
// Per-language dispatch: TypeScript/JavaScript (Istanbul/Vitest coverage-summary.json)
// is implemented robustly. Java (JaCoCo), Python (coverage.py), Rust (tarpaulin) and
// Go (go cover) are scaffolded to SKIP gracefully when their summary is absent or the
// format is unsupported — NEVER a false-fail.
//
// The ratchet compare is factored into a PURE, exported `compareModuleCoverage` so the
// decision logic is unit-testable in isolation (see __tests__/generators/module-coverage-ratchet.test.ts).

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const SLACK = 0.5 // tolerated per-module regression, in percentage points
const ROOT = process.cwd()
const BASELINE_FILE = join(ROOT, 'module-coverage-baseline.json')

/**
 * Pure ratchet compare. Both maps are { moduleKey: linePct } where linePct is a
 * number 0..100. Greenfield modules (0 executable lines) MUST be excluded by the
 * caller before reaching here. Upward-only:
 *   - a module in `baseline` whose `current` pct dropped more than `slack`  → violation
 *   - a module in `baseline` absent from `current` (rename/deletion)        → violation
 *   - a module in `current` but not in `baseline` (new code)                → ignored
 *   - empty baseline (first run)                                            → no violations
 *
 * @param {Record<string, number>} baseline  module → baselined line pct
 * @param {Record<string, number>} current   module → current line pct
 * @param {number} slack                      tolerated drop in pp (default SLACK)
 * @returns {{ violations: Array<{ module: string, reason: string }> }}
 */
export function compareModuleCoverage(baseline, current, slack = SLACK) {
  const violations = []
  for (const [module, base] of Object.entries(baseline ?? {})) {
    if (typeof base !== 'number') continue
    const cur = current?.[module]
    if (cur === undefined) {
      violations.push({
        module,
        reason: `present in baseline but absent from current coverage (rename/deletion?)`,
      })
      continue
    }
    if (cur + 1e-9 < base - slack) {
      violations.push({
        module,
        reason: `coverage dropped: ${cur.toFixed(1)}% < ${base}% (slack: ${slack}pp)`,
      })
    }
  }
  return { violations }
}

// ─── Per-language extraction ────────────────────────────────────────────────
// Each extractor returns either:
//   - { modules: Record<string, number> }  on success (may be {} = greenfield)
//   - null                                 when this language's summary is absent
//                                          /unsupported → caller SKIPs (no false-fail)
// A module is included only when it has > 0 executable lines (greenfield-aware).

function extractTsCoverage() {
  const file = join(ROOT, 'coverage', 'coverage-summary.json')
  if (!existsSync(file)) return null
  let summary
  try {
    summary = JSON.parse(readFileSync(file, 'utf-8'))
  } catch (err) {
    process.stderr.write(`[verify-module-coverage] failed to parse coverage-summary.json: ${err.message}\n`)
    return null
  }
  if (summary == null || typeof summary !== 'object') return null
  const modules = {}
  for (const [filePath, stats] of Object.entries(summary)) {
    if (filePath === 'total') continue
    const lines = stats?.lines
    if (lines == null || typeof lines !== 'object') continue
    const total = typeof lines.total === 'number' ? lines.total : 0
    if (total <= 0) continue // greenfield module — no executable lines, skip
    const pct =
      typeof lines.pct === 'number'
        ? lines.pct
        : (Number(lines.covered ?? 0) / total) * 100
    modules[filePath] = Math.round(pct * 100) / 100
  }
  return { modules }
}

// Scaffolds — graceful SKIP until each is implemented. They intentionally return null
// (summary absent / format unsupported) so the gate NEVER false-fails on these stacks.
function extractJavaCoverage() {
  // JaCoCo emits target/site/jacoco/jacoco.csv (per-class) or jacoco.xml.
  // TODO(#1457): parse per-package coverage from jacoco.csv/xml. Skip until implemented.
  return null
}
function extractPythonCoverage() {
  // coverage.py emits coverage.json (`coverage json`) with per-file `summary.percent_covered`.
  // TODO(#1457): parse per-file pct from coverage.json. Skip until implemented.
  return null
}
function extractRustCoverage() {
  // cargo-tarpaulin emits cobertura.xml (per-file line-rate).
  // TODO(#1457): parse per-file line-rate from cobertura.xml. Skip until implemented.
  return null
}
function extractGoCoverage() {
  // `go test -coverprofile` emits coverage.out (per-file mode:set blocks).
  // TODO(#1457): aggregate per-file pct from coverage.out. Skip until implemented.
  return null
}

const LANGUAGE = 'typescript'

function extractCoverage() {
  switch (LANGUAGE) {
    case 'typescript':
    case 'javascript':
      return extractTsCoverage()
    case 'java':
    case 'kotlin':
      return extractJavaCoverage()
    case 'python':
      return extractPythonCoverage()
    case 'rust':
      return extractRustCoverage()
    case 'go':
      return extractGoCoverage()
    default:
      // Unknown language — try the TS path opportunistically, else SKIP.
      return extractTsCoverage()
  }
}

// ─── Main (skipped under test import — only runs when executed directly) ─────
function main() {
  const UPDATE_BASELINE = process.argv.includes('--update-baseline')

  const extracted = extractCoverage()
  if (extracted == null) {
    process.stdout.write(
      `[verify-module-coverage] SKIP — no coverage summary for "${LANGUAGE}" (run coverage first, or stack not yet supported)\n`,
    )
    return 0
  }
  const current = extracted.modules

  if (UPDATE_BASELINE) {
    writeFileSync(BASELINE_FILE, JSON.stringify(current, null, 2) + '\n')
    process.stdout.write(
      `[verify-module-coverage] baseline updated (${Object.keys(current).length} modules)\n`,
    )
    return 0
  }

  if (!existsSync(BASELINE_FILE)) {
    // First run with coverage present and no baseline → seed it and pass.
    writeFileSync(BASELINE_FILE, JSON.stringify(current, null, 2) + '\n')
    process.stdout.write(
      `[verify-module-coverage] seeded module-coverage-baseline.json (${Object.keys(current).length} modules) — re-run to ratchet\n`,
    )
    return 0
  }

  let baseline
  try {
    baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8'))
  } catch (err) {
    process.stderr.write(`[verify-module-coverage] failed to parse module-coverage-baseline.json: ${err.message}\n`)
    return 1
  }

  const { violations } = compareModuleCoverage(baseline, current, SLACK)
  if (violations.length > 0) {
    for (const v of violations) {
      process.stderr.write(`[verify-module-coverage] ${v.module}: ${v.reason}\n`)
    }
    process.stderr.write(
      `\n[verify-module-coverage] ${violations.length} per-module coverage regression(s).\n` +
        `  Ratchet is upward-only — coverage must not drop > ${SLACK}pp below module-coverage-baseline.json.\n` +
        `  To advance the baseline: node scripts/verify-module-coverage.mjs --update-baseline\n`,
    )
    return 1
  }

  process.stdout.write(
    `[verify-module-coverage] OK — ${Object.keys(baseline).length} modules within baseline (slack: ${SLACK}pp)\n`,
  )
  return 0
}

// Only execute when run as a script — importing for unit tests must have no side effects.
import { fileURLToPath } from 'node:url'
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main())
}
