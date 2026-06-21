#!/usr/bin/env node
/**
 * Verifies the npm tarball stays within size budget.
 *
 * Usage:
 *   node scripts/check-pack-size.mjs           # warn-only mode
 *   node scripts/check-pack-size.mjs --strict  # fail on warn too
 *
 * Exit codes:
 *   0  — under WARN_BYTES
 *   1  — between WARN_BYTES and HARD_CAP_BYTES (non-fatal unless --strict)
 *   2  — over HARD_CAP_BYTES (always fatal)
 *
 * Budget (re-baselined 2026-06-21, #1491/B6):
 *   Removing source maps from the published build (declarationMap/sourceMap=false +
 *   clean `dist/` on each build) dropped unpacked size 6.20 MB -> 4.64 MB, back under
 *   the 5 MB hard cap. The template/command surface has legitimately grown well past
 *   the original 2026-05-15 baseline (2.04 MB), so WARN is re-set to 4.75 MB to give an
 *   early-warning band below the unchanged hard cap.
 *   WARN_BYTES      = 4,980,736  (4.75 MB)
 *   HARD_CAP_BYTES  = 5,242,880  (5 MB, per issue #511 — UNCHANGED)
 */
import { spawnSync } from 'node:child_process'

const WARN_BYTES = 4_980_736
const HARD_CAP_BYTES = 5 * 1024 * 1024

const strict = process.argv.includes('--strict')

const result = spawnSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf-8' })

if (result.status !== 0) {
  process.stderr.write(`check-pack-size: npm pack failed\n${result.stderr}\n`)
  process.exit(2)
}

let packed
try {
  packed = JSON.parse(result.stdout)
} catch {
  process.stderr.write(`check-pack-size: failed to parse npm pack JSON output\n`)
  process.exit(2)
}

const { unpackedSize, entryCount } = packed[0] ?? {}
if (typeof unpackedSize !== 'number') {
  process.stderr.write(`check-pack-size: unpackedSize missing from npm pack output\n`)
  process.exit(2)
}

const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' MB'

process.stdout.write(
  `pack size check: ${mb(unpackedSize)} unpacked (${entryCount} files)\n` +
    `  warn @ ${mb(WARN_BYTES)} | hard cap @ ${mb(HARD_CAP_BYTES)}\n`,
)

if (unpackedSize > HARD_CAP_BYTES) {
  process.stderr.write(
    `FAIL: unpacked size ${mb(unpackedSize)} exceeds hard cap ${mb(HARD_CAP_BYTES)}\n`,
  )
  process.exit(2)
}

if (unpackedSize > WARN_BYTES) {
  process.stderr.write(
    `WARN: unpacked size ${mb(unpackedSize)} exceeds warn threshold ${mb(WARN_BYTES)}\n`,
  )
  process.exit(strict ? 2 : 1)
}

process.stdout.write(`OK\n`)
process.exit(0)
