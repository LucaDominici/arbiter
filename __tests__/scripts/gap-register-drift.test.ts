// SPDX-License-Identifier: Apache-2.0
// Regression test (#1224): GAP.md must never drift from committed tech-debt evidence.
// Red evidence: without force-adding .arbiter/evidence/*/tech-debt.json, gen-gap
// generates 4 rows not present in committed GAP.md → gate fails.
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const NODE = process.execPath

describe('gap register drift gate (#1224)', () => {
  it('gen-gap.mjs --check: GAP.md must be up to date with committed evidence', () => {
    const result = execFileSync(NODE, ['scripts/gen-gap.mjs', '--check'], {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: 'pipe',
    })
    expect(result.trim()).toContain('up to date')
  })
})
