#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: Reports the npm tarball's unpacked size. Advisory only since #2660: the size is a
// CATALOG: warning line, never an exit code — the budget it used to gate was re-baselined by
// CATALOG: hand three times (#511 → #1491 → #2652) and finally blocked a 1 KB fix. What ships
// CATALOG: is governed by the surface contract instead (__tests__/scripts/pack-surface-2660.test.ts:
// CATALOG: only the scripts/lib closure of the shipped scripts and the .d.ts closure of the
// CATALOG: exports entry points), and by check-tarball-contents.mjs for leaks.
/**
 * Reports the npm tarball size. Exit 0 whenever `npm pack` itself succeeds; a size above
 * WARN_BYTES prints a WARN line and still exits 0 (owner decision, #2660). `--strict` and
 * `--ci` are accepted for callers that still pass them and change nothing.
 *
 * Usage:
 *   node scripts/check-pack-size.mjs
 *
 * Exit codes:
 *   0 — size reported (OK or WARN)
 *   2 — `npm pack --dry-run --json` failed or produced no size
 */
import { spawnSync } from 'node:child_process'
import { isMainModule } from './lib/run-helpers.mjs'

// Notice level only: the size at which the report says WARN. Not a gate.
export const WARN_BYTES = 5_000_000

/**
 * Pure classification: `warn` above WARN_BYTES, `ok` otherwise. The exit code is always 0 —
 * size is information, not a verdict (#2660). Kept as a function so the report is unit-testable.
 *
 * @param {number} unpackedSize bytes
 * @returns {{ level: 'ok'|'warn', exitCode: 0 }}
 */
export function classifyPackSize(unpackedSize) {
  return { level: unpackedSize > WARN_BYTES ? 'warn' : 'ok', exitCode: 0 }
}

const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' MB'

/**
 * Runs `npm pack --dry-run --json` and writes a human report. Side-effecting (spawns npm,
 * writes streams) but does not call process.exit so it stays importable/testable.
 *
 * @returns {number} exit code — 0 unless npm pack itself failed
 */
export function checkPackSize() {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf-8' })

  if (result.status !== 0) {
    process.stderr.write(`check-pack-size: npm pack failed\n${result.stderr}\n`)
    return 2
  }

  let packed
  try {
    packed = JSON.parse(result.stdout)
  } catch {
    process.stderr.write(`check-pack-size: failed to parse npm pack JSON output\n`)
    return 2
  }

  const { unpackedSize, entryCount } = packed[0] ?? {}
  if (typeof unpackedSize !== 'number') {
    process.stderr.write(`check-pack-size: unpackedSize missing from npm pack output\n`)
    return 2
  }

  process.stdout.write(`pack size: ${mb(unpackedSize)} unpacked (${entryCount} files)\n`)
  const { level, exitCode } = classifyPackSize(unpackedSize)
  if (level === 'warn') {
    process.stderr.write(
      `WARN: unpacked size ${mb(unpackedSize)} is above the ${mb(WARN_BYTES)} notice level — ` +
        `not a gate (#2660); check the surface contract before shipping more\n`,
    )
  } else {
    process.stdout.write(`OK\n`)
  }
  return exitCode
}

// Only run when invoked directly (not when imported by tests).
if (isMainModule(import.meta.url)) {
  process.exit(checkPackSize())
}
