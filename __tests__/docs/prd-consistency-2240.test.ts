// SPDX-License-Identifier: Apache-2.0
// #2240 (wave-3 docs) — docs/PRODUCT/PRD.md self-contradicted itself: the Open
// Questions table listed "Plugin API design | Future" while the Features-by-Phase
// section already documented it as shipped in M32, and the governance-tier line
// hardcoded "Arbiter itself operates at L3" while the project's actual governance
// level is read from `arbiter.json` (`governanceLevel`) and changes as it matures.
// These assertions pin both fixes so the contradictions cannot regress.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const doc = readFileSync(resolve('docs/PRODUCT/PRD.md'), 'utf-8')

describe('#2240 — PRD.md no longer self-contradicts', () => {
  it('Open Questions no longer lists Plugin API design as a Future placeholder', () => {
    expect(doc).not.toMatch(/\|\s*Plugin API design\s*\|\s*Future\s*\|/)
    expect(doc).toMatch(/\|\s*Plugin API design\s*\|\s*Decided\s*\|\s*Shipped in M32/)
  })

  it('governance-tier line points to arbiter.json instead of hardcoding a tier', () => {
    expect(doc).not.toContain('Arbiter itself operates at L3')
    expect(doc).toContain('governanceLevel')
    expect(doc).toMatch(/`arbiter\.json` declares \(`governanceLevel`\)/)
  })
})
