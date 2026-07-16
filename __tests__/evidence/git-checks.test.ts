// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi } from 'vitest'
import {
  shaExistsOnBranch,
  pathExistsInCommit,
  currentBranch,
  headSha,
  gitCwd,
} from '../../src/evidence/git-checks.js'

vi.mock('../../src/utils/run-cli.js', () => ({
  runCli: vi.fn(),
}))

import { runCli } from '../../src/utils/run-cli.js'
const mockedRunCli = vi.mocked(runCli)

describe('shaExistsOnBranch()', () => {
  it('returns true when git cat-file exits 0', () => {
    mockedRunCli.mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 })
    expect(shaExistsOnBranch('a'.repeat(40))).toBe(true)
  })

  it('returns false when git cat-file exits non-zero', () => {
    mockedRunCli.mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 1, durationMs: 5 })
    expect(shaExistsOnBranch('deadbeef')).toBe(false)
  })

  it('returns false when runCli throws', () => {
    mockedRunCli.mockImplementationOnce(() => {
      throw new Error('git not found')
    })
    expect(shaExistsOnBranch('a'.repeat(40))).toBe(false)
  })
})

describe('pathExistsInCommit()', () => {
  it('returns true when git ls-tree exits 0 with non-empty stdout', () => {
    mockedRunCli.mockReturnValueOnce({
      stdout: 'src/foo.ts',
      stderr: '',
      exitCode: 0,
      durationMs: 5,
    })
    expect(pathExistsInCommit('a'.repeat(40), 'src/foo.ts')).toBe(true)
  })

  it('returns false when git ls-tree exits 0 with empty stdout', () => {
    mockedRunCli.mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 })
    expect(pathExistsInCommit('a'.repeat(40), 'src/missing.ts')).toBe(false)
  })

  it('returns false when git ls-tree exits non-zero', () => {
    mockedRunCli.mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 128, durationMs: 5 })
    expect(pathExistsInCommit('deadbeef', 'src/foo.ts')).toBe(false)
  })

  it('returns false when runCli throws', () => {
    mockedRunCli.mockImplementationOnce(() => {
      throw new Error('git error')
    })
    expect(pathExistsInCommit('a'.repeat(40), 'src/foo.ts')).toBe(false)
  })
})

describe('currentBranch() / headSha() (#1212)', () => {
  it('currentBranch returns the trimmed symbolic name on success', () => {
    mockedRunCli.mockReturnValueOnce({
      stdout: 'feature/x\n',
      stderr: '',
      exitCode: 0,
      durationMs: 5,
    })
    expect(currentBranch()).toBe('feature/x')
  })

  it('currentBranch returns "unknown" when git exits non-zero', () => {
    mockedRunCli.mockReturnValueOnce({ stdout: '', stderr: 'fatal', exitCode: 128, durationMs: 5 })
    expect(currentBranch()).toBe('unknown')
  })

  it('currentBranch returns "unknown" when git succeeds with empty output', () => {
    mockedRunCli.mockReturnValueOnce({ stdout: '  \n', stderr: '', exitCode: 0, durationMs: 5 })
    expect(currentBranch()).toBe('unknown')
  })

  it('headSha returns the trimmed sha on success', () => {
    mockedRunCli.mockReturnValueOnce({
      stdout: `${'c'.repeat(40)}\n`,
      stderr: '',
      exitCode: 0,
      durationMs: 5,
    })
    expect(headSha()).toBe('c'.repeat(40))
  })

  it('headSha returns "unknown" when runCli throws (outside a git work tree)', () => {
    mockedRunCli.mockImplementationOnce(() => {
      throw new Error('not a git repository')
    })
    expect(headSha()).toBe('unknown')
  })
})

describe('gitCwd()', () => {
  it('prefers ARBITER_HOOK_GIT_CWD, then the explicit dir, then process.cwd()', () => {
    const saved = process.env.ARBITER_HOOK_GIT_CWD
    try {
      process.env.ARBITER_HOOK_GIT_CWD = '/hook/repo'
      expect(gitCwd('/explicit')).toBe('/hook/repo')
      delete process.env.ARBITER_HOOK_GIT_CWD
      expect(gitCwd('/explicit')).toBe('/explicit')
      expect(gitCwd()).toBe(process.cwd())
    } finally {
      if (saved !== undefined) process.env.ARBITER_HOOK_GIT_CWD = saved
      else delete process.env.ARBITER_HOOK_GIT_CWD
    }
  })
})
