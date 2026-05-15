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
 * Budget (established 2026-05-15, baseline unpackedSize = 2,140,867 B = 2.04 MB):
 *   WARN_BYTES      = 3,211,301  (~1.5× baseline, ~3.06 MB)
 *   HARD_CAP_BYTES  = 5,242,880  (5 MB, per issue #511)
 */
import { spawnSync } from 'node:child_process'

const WARN_BYTES = 3_211_301
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
