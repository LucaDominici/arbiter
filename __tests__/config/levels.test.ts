// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { LEVEL_ORDER, levelRank, levelAtLeast } from '../../src/config/levels.js'
import type { GovernanceLevel } from '../../src/wizard/types.js'

describe('config/levels — governance ordinal SSOT (#1516)', () => {
  it('orders the four governance levels low→high', () => {
    expect([...LEVEL_ORDER]).toEqual(['L1', 'L2', 'L3', 'L4'])
  })

  it('ranks levels by ordinal position', () => {
    expect(levelRank('L1')).toBe(0)
    expect(levelRank('L2')).toBe(1)
    expect(levelRank('L3')).toBe(2)
    expect(levelRank('L4')).toBe(3)
  })

  describe('levelAtLeast', () => {
    it('reproduces the "at least L3" boundary (=== L3 || === L4)', () => {
      const levels: GovernanceLevel[] = ['L1', 'L2', 'L3', 'L4']
      for (const l of levels) {
        const legacy = l === 'L3' || l === 'L4'
        expect(levelAtLeast(l, 'L3')).toBe(legacy)
      }
    })

    it('reproduces the "at least L2" boundary (!== L1)', () => {
      const levels: GovernanceLevel[] = ['L1', 'L2', 'L3', 'L4']
      for (const l of levels) {
        expect(levelAtLeast(l, 'L2')).toBe(l !== 'L1')
      }
    })

    it('is reflexive and monotone', () => {
      expect(levelAtLeast('L1', 'L1')).toBe(true)
      expect(levelAtLeast('L4', 'L1')).toBe(true)
      expect(levelAtLeast('L1', 'L4')).toBe(false)
      expect(levelAtLeast('L3', 'L4')).toBe(false)
    })
  })
})
