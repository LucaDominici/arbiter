// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import {
  parseTaskIdsFromLog,
  hasSkipTrailer,
  formatSkipError,
} from '../../scripts/check-tdd-evidence.mjs'

describe('parseTaskIdsFromLog', () => {
  it('extracts task IDs from git log subject lines', () => {
    const log = [
      'feat(#551): add TDD evidence schema',
      'fix(#552): correct evidence path',
      'docs(#553): update AGENTS.md',
    ].join('\n')
    expect(parseTaskIdsFromLog(log)).toEqual(['#551', '#552', '#553'])
  })

  it('deduplicates task IDs appearing multiple times', () => {
    const log = ['feat(#551): first commit', 'fix(#551): follow-up commit'].join('\n')
    expect(parseTaskIdsFromLog(log)).toEqual(['#551'])
  })

  it('returns empty array when no task IDs found', () => {
    const log = 'chore: update deps\ndocs: fix typo'
    expect(parseTaskIdsFromLog(log)).toEqual([])
  })

  it('ignores lines that only mention IDs in body text without type prefix', () => {
    const log = 'feat(#551): fixes #552 and closes #553'
    // only #551 from the conventional commit prefix counts
    expect(parseTaskIdsFromLog(log)).toEqual(['#551'])
  })

  it('handles multiple IDs in a single commit subject (space-separated)', () => {
    const log = 'feat(#551 #552): bundle commit'
    expect(parseTaskIdsFromLog(log)).toEqual(['#551', '#552'])
  })
})

describe('hasSkipTrailer', () => {
  it('returns true for ARBITER-SKIP-TDD: 1 trailer', () => {
    const body = 'feat(#551): some change\n\nARBITER-SKIP-TDD: 1\n'
    expect(hasSkipTrailer(body)).toBe(true)
  })

  it('returns false when trailer is absent', () => {
    const body = 'feat(#551): some change\n\nSigned-off-by: Dev <dev@example.com>\n'
    expect(hasSkipTrailer(body)).toBe(false)
  })

  it('returns false for partial match (not value 1)', () => {
    const body = 'feat(#551): change\n\nARBITER-SKIP-TDD: 0\n'
    expect(hasSkipTrailer(body)).toBe(false)
  })

  it('is case-sensitive — wrong case does not match', () => {
    const body = 'arbiter-skip-tdd: 1\n'
    expect(hasSkipTrailer(body)).toBe(false)
  })
})

describe('formatSkipError', () => {
  it('returns a non-empty error message containing the sha', () => {
    const msg = formatSkipError('abc1234', '#551')
    expect(msg).toContain('abc1234')
    expect(msg).toContain('#551')
    expect(msg.length).toBeGreaterThan(10)
  })
})
