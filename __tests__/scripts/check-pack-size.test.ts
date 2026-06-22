// SPDX-License-Identifier: Apache-2.0
//
// Regression coverage for the npm tarball size guard (#1491 / B6).
//
// Two surfaces are pinned here:
//   1. classifyPackSize() — the pure threshold-decision logic. Every band
//      (OK / warn / hard-cap) × every mode (default / strict / ci) is asserted
//      so the exit-code contract cannot silently regress.
//   2. The release workflow wiring — `.github/workflows/05-release.yml` must run
//      the pack-size guard in its build stage, not only at the terminal
//      prepublishOnly gate. B6 wired publish-time enforcement but left no early
//      signal: with a hard cap and shrinking headroom, a size regression would
//      only surface when a human ran `npm publish`, blocking the whole release.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { classifyPackSize, WARN_BYTES, HARD_CAP_BYTES } from '../../scripts/check-pack-size.mjs'

describe('classifyPackSize — threshold/exit-code contract (#1491/B6)', () => {
  const underWarn = WARN_BYTES - 1
  const inWarnBand = WARN_BYTES + 1
  const overCap = HARD_CAP_BYTES + 1

  it('thresholds are ordered warn < hard-cap and match issue #511 (5 MB cap)', () => {
    expect(WARN_BYTES).toBeLessThan(HARD_CAP_BYTES)
    expect(HARD_CAP_BYTES).toBe(5 * 1024 * 1024)
  })

  it('under warn → OK, exit 0, in every mode', () => {
    for (const mode of ['default', 'strict', 'ci'] as const) {
      expect(classifyPackSize(underWarn, mode)).toEqual({ level: 'ok', exitCode: 0 })
    }
  })

  it('warn band → exit 1 by default (non-fatal warning)', () => {
    expect(classifyPackSize(inWarnBand, 'default')).toEqual({ level: 'warn', exitCode: 1 })
  })

  it('warn band → exit 2 under --strict (publish gate blocks the band)', () => {
    expect(classifyPackSize(inWarnBand, 'strict')).toEqual({ level: 'warn', exitCode: 2 })
  })

  it('warn band → exit 0 under --ci (early signal, does not fail the build)', () => {
    // The whole point of the CI mode: surface the warn band loudly in logs
    // without failing every PR that lives in the 4.75–5.0 MB band.
    expect(classifyPackSize(inWarnBand, 'ci')).toEqual({ level: 'warn', exitCode: 0 })
  })

  it('over hard cap → exit 2 in EVERY mode (always fatal, never bypassable)', () => {
    for (const mode of ['default', 'strict', 'ci'] as const) {
      expect(classifyPackSize(overCap, mode)).toEqual({ level: 'over-cap', exitCode: 2 })
    }
  })

  it('exactly at hard cap is allowed (boundary is exclusive)', () => {
    expect(classifyPackSize(HARD_CAP_BYTES, 'ci').level).not.toBe('over-cap')
  })
})

describe('release workflow wires the pack-size guard into CI (#1491/B6)', () => {
  const releaseYml = readFileSync(resolve('.github/workflows/05-release.yml'), 'utf-8')

  it('build-superset job runs the pack-size guard after build (early signal)', () => {
    // Must invoke check-pack-size in the build stage, not only via prepublishOnly.
    expect(releaseYml).toMatch(/check-pack-size\.mjs/)
  })

  it('the CI pack-size step uses --ci mode (hard-cap blocks, warn does not)', () => {
    expect(releaseYml).toMatch(/check-pack-size\.mjs --ci/)
  })
})
