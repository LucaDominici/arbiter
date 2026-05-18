import { describe, it, expect } from 'vitest'
import {
  matches,
  UnparseableConstraintError,
  validateRanges,
} from '../../src/compatibility/matcher.js'

describe('matches', () => {
  it('accepts version within >=X range', () => {
    expect(matches({ major: 20, minor: 11, patch: 1 }, '>=18')).toBe(true)
  })

  it('rejects version below >=X range', () => {
    expect(matches({ major: 16, minor: 0, patch: 0 }, '>=18')).toBe(false)
  })

  it('accepts version within >=X <Y range', () => {
    expect(matches({ major: 20, minor: 11, patch: 1 }, '>=18 <22')).toBe(true)
  })

  it('rejects version above <Y bound', () => {
    expect(matches({ major: 22, minor: 0, patch: 0 }, '>=18 <22')).toBe(false)
  })

  it('accepts exact lower bound with >=X <Y', () => {
    expect(matches({ major: 18, minor: 0, patch: 0 }, '>=18 <22')).toBe(true)
  })

  it('rejects exact upper bound with <Y (exclusive)', () => {
    expect(matches({ major: 22, minor: 0, patch: 0 }, '>=18 <22')).toBe(false)
  })

  it('accepts with >X range', () => {
    expect(matches({ major: 19, minor: 0, patch: 0 }, '>18')).toBe(true)
  })

  it('rejects equal value for >X (strict)', () => {
    expect(matches({ major: 18, minor: 0, patch: 0 }, '>18')).toBe(false)
  })

  it('accepts with <=X range', () => {
    expect(matches({ major: 3, minor: 9, patch: 6 }, '>=3 <=3.9')).toBe(true)
  })

  it('handles single version constraint', () => {
    expect(matches({ major: 1, minor: 22, patch: 0 }, '>=1.21')).toBe(true)
  })

  it('rejects below minor-aware bound', () => {
    expect(matches({ major: 1, minor: 20, patch: 0 }, '>=1.21')).toBe(false)
  })

  // ── #854 — unparseable-constraint throw behaviour ─────────────────────────

  it('throws UnparseableConstraintError on empty range (#854)', () => {
    expect(() => matches({ major: 20, minor: 11, patch: 1 }, '')).toThrow(
      UnparseableConstraintError,
    )
  })

  it('throws UnparseableConstraintError on caret prefix (#854)', () => {
    expect(() => matches({ major: 20, minor: 11, patch: 1 }, '^18')).toThrow(
      UnparseableConstraintError,
    )
  })

  it('throws UnparseableConstraintError on tilde prefix (#854)', () => {
    expect(() => matches({ major: 20, minor: 11, patch: 1 }, '~18')).toThrow(
      UnparseableConstraintError,
    )
  })

  it('throws UnparseableConstraintError on x-range (#854)', () => {
    expect(() => matches({ major: 20, minor: 11, patch: 1 }, '18.x')).toThrow(
      UnparseableConstraintError,
    )
  })

  it('throws UnparseableConstraintError on bare version (#854)', () => {
    expect(() => matches({ major: 20, minor: 11, patch: 1 }, '18')).toThrow(
      UnparseableConstraintError,
    )
  })

  it('error message names the constraint and the full range (#854)', () => {
    try {
      matches({ major: 20, minor: 11, patch: 1 }, '>=18 ^22')
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(UnparseableConstraintError)
      if (err instanceof UnparseableConstraintError) {
        expect(err.constraint).toBe('^22')
        expect(err.range).toBe('>=18 ^22')
        expect(err.message).toContain('^22')
        expect(err.message).toContain('>=18 ^22')
      }
    }
  })
})

describe('validateRanges (#854)', () => {
  it('returns empty list for fully-parseable matrix', () => {
    const failures = validateRanges([
      { tool: 'node', range: '>=18' },
      { tool: 'go', range: '>=1.21' },
      { tool: 'python3', range: '>=3 <=3.12' },
    ])
    expect(failures).toEqual([])
  })

  it('reports every unparseable range with tool + reason', () => {
    const failures = validateRanges([
      { tool: 'node', range: '>=18' }, // ok
      { tool: 'java', range: '^17' }, // bad
      { tool: 'rust', range: '' }, // bad
    ])
    expect(failures).toHaveLength(2)
    expect(failures[0]?.tool).toBe('java')
    expect(failures[0]?.range).toBe('^17')
    expect(failures[0]?.reason).toContain('^17')
    expect(failures[1]?.tool).toBe('rust')
    expect(failures[1]?.range).toBe('')
  })
})
