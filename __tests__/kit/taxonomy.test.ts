// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import {
  VALID_TML,
  VALID_GATES,
  VALID_STACKS,
  VALID_DISPOSITIONS,
  ACCEPTED_FUTURE_WAVES,
} from '../../src/kit/taxonomy.js'

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

describe('VALID_DISPOSITIONS', () => {
  it('contains adopt-self, adopt-framework, stack-adapter, done', () => {
    expect([...VALID_DISPOSITIONS].sort()).toEqual([
      'adopt-framework',
      'adopt-self',
      'done',
      'stack-adapter',
    ])
  })
})

describe('ACCEPTED_FUTURE_WAVES', () => {
  it('includes W3 through W11', () => {
    for (let i = 3; i <= 11; i++) {
      expect(ACCEPTED_FUTURE_WAVES).toContain(`W${i}`)
    }
  })

  it('excludes W1, W2', () => {
    expect(ACCEPTED_FUTURE_WAVES).not.toContain('W1')
    expect(ACCEPTED_FUTURE_WAVES).not.toContain('W2')
  })

  it('excludes F-prefixed values', () => {
    expect(ACCEPTED_FUTURE_WAVES).not.toContain('F2')
    expect(ACCEPTED_FUTURE_WAVES).not.toContain('F5')
    expect(ACCEPTED_FUTURE_WAVES).not.toContain('F12')
  })

  it('excludes null-like values', () => {
    const arr = [...ACCEPTED_FUTURE_WAVES] as string[]
    expect(arr).not.toContain(null)
    expect(arr).not.toContain('')
    expect(arr).not.toContain('null')
  })

  it('excludes lowercase variants', () => {
    expect(ACCEPTED_FUTURE_WAVES).not.toContain('w3')
    expect(ACCEPTED_FUTURE_WAVES).not.toContain('wave3')
  })

  it('excludes W12 (out of range)', () => {
    expect(ACCEPTED_FUTURE_WAVES).not.toContain('W12')
  })
})
