// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi } from 'vitest'
import { shaExistsOnBranch, pathExistsInCommit } from '../../src/evidence/git-checks.js'

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
