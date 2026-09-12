// SPDX-License-Identifier: Apache-2.0
//
// scripts/check-pack-size.mjs is a size REPORT since #2660: it never exits non-zero on
// size (the hand-re-baselined budget of #511/#1491/#2652 is gone). Two surfaces are pinned:
//   1. classifyPackSize() — `warn` above WARN_BYTES, `ok` otherwise, exit code always 0.
//   2. The release workflow still runs the report in its build stage (early signal in logs).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { classifyPackSize, WARN_BYTES } from '../../scripts/check-pack-size.mjs'

describe('classifyPackSize — advisory report (#2660)', () => {
  it('reports ok under the notice level and warn above it', () => {
    expect(classifyPackSize(WARN_BYTES).level).toBe('ok')
    expect(classifyPackSize(WARN_BYTES + 1).level).toBe('warn')
  })

  it('never turns size into an exit code', () => {
    for (const size of [0, WARN_BYTES - 1, WARN_BYTES + 1, 10 * WARN_BYTES]) {
      expect(classifyPackSize(size).exitCode, `size ${size}`).toBe(0)
    }
  })
})

describe('release workflow keeps the size report as an early signal (#1491/B6, #2660)', () => {
  const releaseYml = readFileSync(resolve('.github/workflows/05-release.yml'), 'utf-8')

  it('build-superset job runs the size report after build', () => {
    expect(releaseYml).toMatch(/check-pack-size\.mjs/)
  })
})
