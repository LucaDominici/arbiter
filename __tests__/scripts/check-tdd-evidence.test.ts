// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  parseTaskIdsFromLog,
  hasSkipTrailer,
  formatSkipError,
  main,
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

describe('main()', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function makeRun(responses: Map<string, string>) {
    return (_cmd: string, args: string[]) => {
      const key = args.join(' ')
      for (const [pattern, value] of responses) {
        if (key.includes(pattern)) return value
      }
      throw Object.assign(new Error(`unmocked git call: ${key}`), { stderr: '', stdout: '' })
    }
  }

  const exitFn = vi.fn()

  it('exits 0 vacuously when merge-base fails (no origin/main)', () => {
    exitFn.mockReset()
    const runFn = () => {
      throw new Error('no origin/main')
    }
    main({ runFn, exitFn: exitFn as never })
    expect(exitFn).toHaveBeenCalledWith(0)
  })

  it('exits 0 when no task-ID commits found', () => {
    exitFn.mockReset()
    const responses = new Map([
      ['merge-base', 'deadbeef'],
      ['log', 'chore: update deps\ndocs: fix typo'],
      ['--format=%H', ''],
    ])
    main({ runFn: makeRun(responses) as never, exitFn: exitFn as never })
    expect(exitFn).toHaveBeenCalledWith(0)
  })

  it('exits 1 when skip trailer detected on a task commit', () => {
    exitFn.mockReset()
    const sha = 'a'.repeat(40)
    const bodyLog = `${sha}\nfeat(#551): add thing\n\nARBITER-SKIP-TDD: 1\n\x00`
    const responses = new Map([
      ['merge-base', 'deadbeef'],
      ['--format=%s', 'feat(#551): add thing'],
      ['--format=%H', bodyLog],
    ])
    main({ runFn: makeRun(responses) as never, exitFn: exitFn as never })
    expect(exitFn).toHaveBeenCalledWith(1)
  })

  it('exits 0 when ARBITER_SKIP_TDD=1 after trailer check passes', () => {
    exitFn.mockReset()
    vi.stubEnv('ARBITER_SKIP_TDD', '1')
    const responses = new Map([
      ['merge-base', 'deadbeef'],
      ['--format=%s', 'feat(#551): add thing'],
      ['--format=%H', ''],
    ])
    main({ runFn: makeRun(responses) as never, exitFn: exitFn as never })
    expect(exitFn).toHaveBeenCalledWith(0)
  })

  it('exits 0 when all task IDs verify PASS', () => {
    exitFn.mockReset()
    const responses = new Map([
      ['merge-base', 'deadbeef'],
      ['--format=%s', 'feat(#551): add thing'],
      ['--format=%H', ''],
      ['verify', 'PASS'],
    ])
    main({ runFn: makeRun(responses) as never, exitFn: exitFn as never })
    expect(exitFn).toHaveBeenCalledWith(0)
  })

  it('exits 1 when a task ID fails verification', () => {
    exitFn.mockReset()
    const runFn = (_cmd: string, args: string[]) => {
      const key = args.join(' ')
      if (key.includes('merge-base')) return 'deadbeef'
      if (key.includes('--format=%s')) return 'feat(#551): add thing'
      if (key.includes('--format=%H')) return ''
      // verify tdd → throw (simulates FAIL)
      throw Object.assign(new Error('FAIL'), { stderr: 'evidence not found', stdout: '' })
    }
    main({ runFn: runFn as never, exitFn: exitFn as never })
    expect(exitFn).toHaveBeenCalledWith(1)
  })
})
