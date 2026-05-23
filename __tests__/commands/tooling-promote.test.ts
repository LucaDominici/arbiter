// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { advanceProposalStatus, type ProposalStatus } from '../../src/commands/tooling-promote.js'

const VALID_TRANSITIONS: Array<[ProposalStatus, ProposalStatus]> = [
  ['proposed', 'accepted'],
  ['accepted', 'promotable'],
  ['promotable', 'promoted'],
  ['promoted', 'demoted'],
]

const INVALID_TRANSITIONS: Array<[ProposalStatus, ProposalStatus]> = [
  ['proposed', 'promoted'],
  ['proposed', 'demoted'],
  ['demoted', 'proposed'],
  ['promoted', 'proposed'],
]

describe('advanceProposalStatus — valid transitions', () => {
  for (const [from, to] of VALID_TRANSITIONS) {
    it(`${from} → ${to}`, () => {
      expect(advanceProposalStatus(from, to)).toBe(to)
    })
  }
})

describe('advanceProposalStatus — invalid transitions throw', () => {
  for (const [from, to] of INVALID_TRANSITIONS) {
    it(`${from} → ${to} throws`, () => {
      expect(() => advanceProposalStatus(from, to)).toThrow()
    })
  }
})
