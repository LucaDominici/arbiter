// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { parseExpiredIds } from '../../scripts/gh-cleanup-expired-artifacts.mjs'

describe('parseExpiredIds (#2058)', () => {
  it('extracts only IDs whose expired column is exactly "true"', () => {
    const tsv = ['111\ttrue', '222\tfalse', '333\ttrue'].join('\n')
    expect(parseExpiredIds(tsv)).toEqual(['111', '333'])
  })

  it('returns an empty array for no rows', () => {
    expect(parseExpiredIds('')).toEqual([])
  })

  it('ignores blank lines', () => {
    const tsv = ['111\ttrue', '', '222\tfalse', ''].join('\n')
    expect(parseExpiredIds(tsv)).toEqual(['111'])
  })

  it('ignores a row with a malformed/missing expired column', () => {
    const tsv = ['111\ttrue', '222', '333\ttrueish'].join('\n')
    expect(parseExpiredIds(tsv)).toEqual(['111'])
  })

  it('handles undefined/null input without throwing', () => {
    expect(parseExpiredIds(undefined)).toEqual([])
    expect(parseExpiredIds(null)).toEqual([])
  })
})
