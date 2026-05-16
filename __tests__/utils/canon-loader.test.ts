// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { loadCanonEntries } from '../../src/utils/canon-loader.js'

const CANON_PATH = join(import.meta.dirname, '../../docs/SYSTEM/CANON.md')

describe('loadCanonEntries', () => {
  it('parses at least 14 entries from CANON.md', () => {
    const entries = loadCanonEntries(CANON_PATH)
    expect(entries.length).toBeGreaterThanOrEqual(14)
  })

  it('parses CANON-01 correctly', () => {
    const entries = loadCanonEntries(CANON_PATH)
    const canon01 = entries.find((e) => e.id === 'CANON-01')
    expect(canon01).toBeDefined()
    expect(canon01?.title).toContain('Dual-sided')
    expect(canon01?.rule.length).toBeGreaterThan(10)
    expect(canon01?.why.length).toBeGreaterThan(10)
    expect(canon01?.enforcement.length).toBeGreaterThan(0)
  })

  it('parses CANON-14 correctly', () => {
    const entries = loadCanonEntries(CANON_PATH)
    const c14 = entries.find((e) => e.id === 'CANON-14')
    expect(c14).toBeDefined()
    expect(c14?.id).toBe('CANON-14')
  })

  it('returns empty array for nonexistent file', () => {
    const entries = loadCanonEntries('/nonexistent/path/CANON.md')
    expect(entries).toEqual([])
  })

  it('sourceIssues is string when present', () => {
    const entries = loadCanonEntries(CANON_PATH)
    const withIssues = entries.filter((e) => e.sourceIssues !== undefined)
    expect(withIssues.length).toBeGreaterThan(0)
    for (const e of withIssues) {
      expect(typeof e.sourceIssues).toBe('string')
    }
  })
})
