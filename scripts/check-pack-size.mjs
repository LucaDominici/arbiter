#!/usr/bin/env node
/**
 * Verifies the npm tarball stays within size budget.
 *
 * Usage:
 *   node scripts/check-pack-size.mjs           # warn-only mode (warn band exits 1)
 *   node scripts/check-pack-size.mjs --strict  # publish gate: warn band is fatal
 *   node scripts/check-pack-size.mjs --ci       # CI early-signal: warn prints but
 *                                                 only a hard-cap breach fails the build
 *
 * Exit codes:
 *   0  — under WARN_BYTES (or in the warn band under --ci)
 *   1  — between WARN_BYTES and HARD_CAP_BYTES (default mode; fatal under --strict)
 *   2  — over HARD_CAP_BYTES (always fatal, every mode)
 *
 * Modes:
 *   default — warn band is a non-zero (1) exit so an interactive `npm run pack:size`
 *             surfaces it; hard cap is fatal (2).
 *   --strict — used by `prepublishOnly`: the warn band ALSO blocks (exit 2) so a
 *             release never ships in the early-warning band unnoticed.
 *   --ci    — used by the release build job: prints the warn band loudly to stderr
 *             but exits 0 for it, so a PR living in the 4.75–5.0 MB band does not
 *             fail every build; a hard-cap breach still fails (exit 2). This is the
 *             early signal B6's prepublishOnly-only wiring lacked — it surfaces the
 *             breach at the START of a release run instead of at the terminal publish
 *             gate where it would block the whole release with no prior warning.
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
import { isMainModule } from './lib/run-helpers.mjs'

export const WARN_BYTES = 4_980_736
export const HARD_CAP_BYTES = 5 * 1024 * 1024

/**
 * Pure threshold-decision logic. Maps an unpacked-size measurement and an
 * enforcement mode to a {level, exitCode} verdict. Kept side-effect-free so every
 * band × mode combination is unit-testable without spawning `npm pack`.
 *
 * @param {number} unpackedSize bytes
 * @param {'default'|'strict'|'ci'} mode
 * @returns {{ level: 'ok'|'warn'|'over-cap', exitCode: 0|1|2 }}
 */
export function classifyPackSize(unpackedSize, mode = 'default') {
  if (unpackedSize > HARD_CAP_BYTES) {
    // Hard cap is fatal in every mode — never bypassable.
    return { level: 'over-cap', exitCode: 2 }
  }
  if (unpackedSize > WARN_BYTES) {
    if (mode === 'strict') return { level: 'warn', exitCode: 2 }
    if (mode === 'ci') return { level: 'warn', exitCode: 0 }
    return { level: 'warn', exitCode: 1 }
  }
  return { level: 'ok', exitCode: 0 }
}

const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' MB'

/**
 * Runs `npm pack --dry-run --json`, classifies the result, writes a human report,
 * and returns the exit code. Side-effecting (spawns npm, writes streams) but does
 * not call process.exit so it stays importable/testable.
 *
 * @param {'default'|'strict'|'ci'} mode
 * @returns {number} exit code
 */
export function checkPackSize(mode = 'default') {
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

  process.stdout.write(
    `pack size check: ${mb(unpackedSize)} unpacked (${entryCount} files)\n` +
      `  warn @ ${mb(WARN_BYTES)} | hard cap @ ${mb(HARD_CAP_BYTES)}\n`,
  )

  const { level, exitCode } = classifyPackSize(unpackedSize, mode)

  if (level === 'over-cap') {
    process.stderr.write(
      `FAIL: unpacked size ${mb(unpackedSize)} exceeds hard cap ${mb(HARD_CAP_BYTES)}\n`,
    )
    return exitCode
  }

  if (level === 'warn') {
    process.stderr.write(
      `WARN: unpacked size ${mb(unpackedSize)} exceeds warn threshold ${mb(WARN_BYTES)}` +
        (mode === 'ci' ? ' (non-fatal in CI mode — under hard cap)' : '') +
        `\n`,
    )
    return exitCode
  }

  process.stdout.write(`OK\n`)
  return exitCode
}

function parseMode(argv) {
  if (argv.includes('--strict')) return 'strict'
  if (argv.includes('--ci')) return 'ci'
  return 'default'
}

// Only run when invoked directly (not when imported by tests).
if (isMainModule(import.meta.url)) {
  process.exit(checkPackSize(parseMode(process.argv)))
}
