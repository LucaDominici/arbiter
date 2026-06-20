// SPDX-License-Identifier: Apache-2.0
// RED phase (#1447, INV-132, ADR-098): `arbiter init --tier <bootstrap|L1|L2|L3|L4>`
// is a progressive-adoption on-ramp. `bootstrap` is the gentlest Day-1 entry —
// governance L1 (the minimal runnable gate) plus brownfield baseline lock-in so
// pre-existing debt is captured, not blocking. L1–L4 are governance-level aliases.
// A bootstrap init must produce a runnable minimal gate.
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveAdoptionTier } from '../../src/commands/init.js'
import { generateCheckAll } from '../../src/generators/check-all.js'
import { makeConfig } from '../helpers.js'

describe('resolveAdoptionTier (#1447, ADR-098)', () => {
  it('bootstrap → governance L1 + brownfield baseline lock-in (gentlest Day-1)', () => {
    expect(resolveAdoptionTier('bootstrap')).toEqual({ governanceLevel: 'L1', brownfield: true })
  })

  it('L1–L4 are pass-through aliases with no forced brownfield', () => {
    for (const level of ['L1', 'L2', 'L3', 'L4'] as const) {
      expect(resolveAdoptionTier(level)).toEqual({ governanceLevel: level, brownfield: false })
    }
  })

  it('an unknown tier is rejected', () => {
    expect(() => resolveAdoptionTier('gold')).toThrow()
    expect(() => resolveAdoptionTier('')).toThrow()
  })
})

describe('bootstrap tier produces a runnable minimal gate (#1447)', () => {
  it('the bootstrap (L1) config emits a runnable check-all.mjs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'boot-'))
    try {
      const { governanceLevel, brownfield } = resolveAdoptionTier('bootstrap')
      expect(governanceLevel).toBe('L1') // minimal runnable gate
      expect(brownfield).toBe(true) // day-0 debt lock-in so a messy repo isn't day-1 red
      const result = generateCheckAll(makeConfig(dir, { governanceLevel }))
      const checkAll = result.files.find((f) => f.path.endsWith('scripts/check-all.mjs'))
      expect(checkAll).toBeDefined()
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content.startsWith('#!/usr/bin/env node')).toBe(true)
      expect(content).toContain('Quality Gate') // a real, runnable gate
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
