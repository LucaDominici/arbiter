#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: INV-25 enforcement. Coverage no-regression ratchet. Reads the deterministic
// CATALOG:   coverage/coverage-summary.json (v8 json-summary reporter) and compares the four
// CATALOG:   totals (lines/branches/functions/statements) against .coverage-baseline.json. Any
// CATALOG:   metric that drops more than TOLERANCE below its baseline FAILS the gate (exit 1) —
// CATALOG:   so a wave can only hold or improve coverage, never silently erode it. Bootstrap:
// CATALOG:   a missing baseline is written from the current summary (exit 0). Ratchet: --update
// CATALOG:   writes max(current, baseline) per metric (monotonic, never lowered).
// CATALOG: Rejected fold-in into debt-report.mjs (the debt ratchet tracks a single coverageLine
// CATALOG:   point metric; this gate owns all four coverage axes + the bootstrap/update lifecycle).
//
// Exit codes per INV-53: 0=PASS (or bootstrap, or the #1731 local degrade below),
// 1=FAIL (a metric regressed), 2=ERROR (summary absent/unreadable/genuinely empty in CI).
// TOLERANCE absorbs sub-0.4pp v8 run-to-run jitter. With the 90.41% branch
// baseline this retains a 90.01% ratchet floor above the 90% hard threshold
// (#2319), so the early-warning band cannot invert.
//
// #1731: some sandboxed local agent-worktree environments have a broken
// @vitest/coverage-v8 remapping step that emits a structurally-valid but totally
// empty summary (every metric total=0, pct the STRING 'Unknown') even though the
// suite genuinely ran thousands of passing tests — a data-collection failure, not a
// real coverage result (verified: raw node:inspector coverage works fine in the same
// sandbox; only the vitest provider's aggregation drops the data). Detected ONLY by
// the exact all-four-metrics zero+'Unknown' signature so a real regression (always
// numeric, however low) or a genuinely-corrupted summary still hard-fails everywhere.
// Fails closed in CI (empty coverage in CI is a real problem); degrades to a loud,
// unmissable WARN locally so this documented sandbox defect doesn't block every local
// gate run. Never silently passes — the local run stays highly visible as a WARN, and
// CI remains the authoritative, unaffected gate.
// Usage: node scripts/check-coverage-ratchet.mjs [--summary <path>] [--baseline <path>] [--update]

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const METRICS = ['lines', 'branches', 'functions', 'statements']
const TOLERANCE = 0.4
// Mirrors scripts/lib/run-helpers.mjs's IS_CI (not imported — this script is
// intentionally standalone/dependency-free, invokable outside the check-all.mjs harness).
const IS_CI = () => process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true'

const args = process.argv.slice(2)

if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    [
      'Usage: node scripts/check-coverage-ratchet.mjs [options]',
      '',
      'Coverage no-regression ratchet over coverage/coverage-summary.json.',
      '',
      'Options:',
      '  --summary <path>   coverage-summary.json (default: coverage/coverage-summary.json)',
      '  --baseline <path>  ratchet baseline (default: .coverage-baseline.json)',
      '  --update           ratchet the baseline up to max(current, baseline) per metric',
      '  --help, -h         show this help and exit',
      '',
      'Exit codes: 0=PASS/bootstrap (or #1731 local degrade), 1=FAIL (regression), 2=ERROR.',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

function flagValue(name, fallback) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const SUMMARY = resolve(flagValue('--summary', 'coverage/coverage-summary.json'))
const BASELINE = resolve(flagValue('--baseline', '.coverage-baseline.json'))
const UPDATE = args.includes('--update')

/**
 * #1731: detects the exact "v8 instrumented nothing" signature — every metric
 * structurally present but zeroed with pct the STRING 'Unknown'. A real regression
 * always reports genuine (if lower) numeric percentages, and a partially-written or
 * otherwise-corrupted summary will NOT match on all four metrics simultaneously — so
 * this stays narrow: it only fires on the one known, fully-characterized defect shape.
 */
function isEmptyInstrumentationSignature(total) {
  return METRICS.every((m) => total?.[m]?.pct === 'Unknown' && total?.[m]?.total === 0)
}

/** Read the four total percentages from an already-parsed v8 json-summary `total` object. */
function readCurrent(total) {
  const out = {}
  for (const m of METRICS) {
    const pct = total?.[m]?.pct
    if (typeof pct !== 'number' || !Number.isFinite(pct)) {
      throw new Error(`coverage-summary.json missing total.${m}.pct`)
    }
    out[m] = pct
  }
  return out
}

function main() {
  if (!existsSync(SUMMARY)) {
    process.stderr.write(
      `  check-coverage-ratchet: ERROR coverage summary not found: ${SUMMARY}\n` +
        `  Run the suite with --coverage first (it emits coverage/coverage-summary.json).\n`,
    )
    return 2
  }

  let total
  try {
    total = JSON.parse(readFileSync(SUMMARY, 'utf-8')).total
  } catch (err) {
    process.stderr.write(`  check-coverage-ratchet: ERROR ${err?.message ?? err}\n`)
    return 2
  }

  if (isEmptyInstrumentationSignature(total)) {
    if (IS_CI()) {
      process.stderr.write(
        `  check-coverage-ratchet: ERROR coverage-summary.json shows 0 instrumented files ` +
          `in CI (all metrics zeroed, pct 'Unknown'). This should never happen in CI — ` +
          `failing closed. See #1731 for the known local-only sandbox variant of this shape.\n`,
      )
      return 2
    }
    process.stdout.write(
      `  check-coverage-ratchet: WARN — v8 coverage collected 0 files (known local-sandbox\n` +
        `  defect, tracked as #1731: some agent-worktree environments' @vitest/coverage-v8\n` +
        `  remapping silently drops all coverage data). Degrading to a local-only SKIP; CI\n` +
        `  stays fail-closed and is the authoritative gate for this check. This is NOT a\n` +
        `  passing coverage result — verify via the real CI run before trusting it.\n`,
    )
    return 0
  }

  let current
  try {
    current = readCurrent(total)
  } catch (err) {
    process.stderr.write(`  check-coverage-ratchet: ERROR ${err?.message ?? err}\n`)
    return 2
  }

  // Bootstrap: no baseline yet → record the current floor and pass.
  if (!existsSync(BASELINE)) {
    writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n')
    process.stdout.write(
      `  check-coverage-ratchet: baseline bootstrapped → ${BASELINE} ` +
        `(L ${current.lines} / B ${current.branches} / F ${current.functions} / S ${current.statements})\n`,
    )
    return 0
  }

  const baseline = JSON.parse(readFileSync(BASELINE, 'utf-8'))

  if (UPDATE) {
    const next = {}
    for (const m of METRICS) next[m] = Math.max(current[m], Number(baseline[m] ?? 0))
    writeFileSync(BASELINE, JSON.stringify(next, null, 2) + '\n')
    process.stdout.write(
      `  check-coverage-ratchet: baseline ratcheted → ` +
        `L ${next.lines} / B ${next.branches} / F ${next.functions} / S ${next.statements}\n`,
    )
    return 0
  }

  const regressions = []
  for (const m of METRICS) {
    const base = Number(baseline[m] ?? 0)
    if (current[m] < base - TOLERANCE) {
      regressions.push(
        `${m}: ${current[m]}% < baseline ${base}% (−${(base - current[m]).toFixed(2)}pp)`,
      )
    }
  }

  if (regressions.length > 0) {
    process.stderr.write(
      `  check-coverage-ratchet: FAIL — coverage regressed below the ratchet floor:\n` +
        regressions.map((r) => `    - ${r}`).join('\n') +
        `\n  Add tests to restore coverage, or (only on a genuine, justified improvement elsewhere)\n` +
        `  run: node scripts/check-coverage-ratchet.mjs --update\n`,
    )
    return 1
  }

  process.stdout.write(
    `  check-coverage-ratchet: OK (L ${current.lines} / B ${current.branches} / ` +
      `F ${current.functions} / S ${current.statements} ≥ baseline within ${TOLERANCE}pp)\n`,
  )
  return 0
}

process.exit(main())
