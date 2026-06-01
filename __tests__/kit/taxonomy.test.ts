// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { VALID_TML, VALID_GATES, VALID_STACKS } from '../../src/kit/taxonomy.js'

describe('VALID_TML', () => {
  it('contains exactly L1, L2, L3, L4', () => {
    expect([...VALID_TML].sort()).toEqual(['L1', 'L2', 'L3', 'L4'])
  })
})

describe('VALID_GATES', () => {
  it('contains exactly BLOCKING, ADVISORY, REFERENCE', () => {
    expect([...VALID_GATES].sort()).toEqual(['ADVISORY', 'BLOCKING', 'REFERENCE'])
  })
})

describe('VALID_STACKS', () => {
  it('contains exactly 5 stacks', () => {
    expect(VALID_STACKS).toHaveLength(5)
  })

  it('matches schema.ts VALID_STACKS re-export', async () => {
    const { VALID_STACKS: schemaStacks } = await import('../../src/kit/schema.js')
    expect([...VALID_STACKS].sort()).toEqual([...schemaStacks].sort())
  })
})
