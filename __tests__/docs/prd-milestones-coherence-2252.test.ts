// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const prd = readFileSync(resolve('docs/PRODUCT/PRD.md'), 'utf8')
const milestones = readFileSync(resolve('docs/internal/PRODUCT/MILESTONES.md'), 'utf8')

describe('#2252 — PRD and milestone reconciliation agree', () => {
  it('records the closed Phase 10/11 ranges through the milestone SSOT', () => {
    expect(prd).toContain('### Phase 10 — Production Baseline Enforcement (M22-M30, shipped)')
    expect(prd).toContain('### Phase 11 — Ecosystem (M31-M33, shipped)')
    expect(prd).toContain('docs/internal/PRODUCT/MILESTONES.md')
    expect(milestones).toContain('## Phase 10 — Production Baseline Enforcement (M22-M30)')
  })

  it('marks the six reconciled milestones and records the formatting repair', () => {
    for (const id of ['M23', 'M24', 'M29', 'M31', 'M32', 'M33']) {
      expect(milestones).toContain(`## ${id} `)
      expect(milestones).toMatch(new RegExp(`## ${id}[^\\n]*✅`))
    }
    expect(milestones).toMatch(/Wave 5 reconciled\s+all six header markers/)
    expect(milestones).not.toContain('_(no header marker)_')
  })
})
