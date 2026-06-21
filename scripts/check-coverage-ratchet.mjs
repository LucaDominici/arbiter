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
// Exit codes per INV-53: 0=PASS (or bootstrap), 1=FAIL (a metric regressed), 2=ERROR (summary
// absent/unreadable). TOLERANCE absorbs sub-0.5pp v8 run-to-run jitter (documented, not a leak:
// a real regression is always > 0.5pp across the ~12k-line product surface).
// Usage: node scripts/check-coverage-ratchet.mjs [--summary <path>] [--baseline <path>] [--update]

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const METRICS = ['lines', 'branches', 'functions', 'statements']
const TOLERANCE = 0.5

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
      'Exit codes: 0=PASS/bootstrap, 1=FAIL (regression), 2=ERROR (summary absent).',
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

/** Read the four total percentages from a v8 json-summary report. */
function readCurrent(path) {
  const total = JSON.parse(readFileSync(path, 'utf-8')).total
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

  let current
  try {
    current = readCurrent(SUMMARY)
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
