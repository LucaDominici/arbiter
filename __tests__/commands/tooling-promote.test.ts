// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { advanceProposalStatus, type ProposalStatus } from '../../src/commands/tooling-promote.js'

const ALL_STATES: ProposalStatus[] = ['proposed', 'accepted', 'promotable', 'promoted', 'demoted']

const VALID_TRANSITIONS: Array<[ProposalStatus, ProposalStatus]> = [
  ['proposed', 'accepted'],
  ['accepted', 'promotable'],
  ['promotable', 'promoted'],
  ['promoted', 'demoted'],
]

const VALID_SET = new Set(VALID_TRANSITIONS.map(([f, t]) => `${f}→${t}`))

const INVALID_TRANSITIONS: Array<[ProposalStatus, ProposalStatus]> = ALL_STATES.flatMap((from) =>
  ALL_STATES.filter((to) => !VALID_SET.has(`${from}→${to}`)).map(
    (to): [ProposalStatus, ProposalStatus] => [from, to],
  ),
)

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

describe('advanceProposalStatus — demoted is terminal', () => {
  it('demoted cannot transition to any state', () => {
    for (const to of ALL_STATES) {
      expect(() => advanceProposalStatus('demoted', to)).toThrow()
    }
  })
})
