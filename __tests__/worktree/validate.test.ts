import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as runCliModule from '../../src/utils/run-cli.js'

vi.mock('../../src/utils/run-cli.js', () => ({
  runCli: vi.fn(),
  CliError: class CliError extends Error {
    exitCode: number
    constructor(msg: string, exitCode: number) {
      super(msg)
      this.exitCode = exitCode
    }
  },
}))

const mockRunCli = vi.mocked(runCliModule.runCli)

describe('branchFullyMerged', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetAllMocks()
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits a stderr warning when git fetch fails, then proceeds', async () => {
    const { branchFullyMerged } = await import('../../src/worktree/validate.js')
    const { CliError } = await import('../../src/utils/run-cli.js')

    mockRunCli
      .mockImplementationOnce(() => {
        throw new Error('network unreachable')
      })
      // merge-base --is-ancestor succeeds (branch is merged)
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0 })

    const result = branchFullyMerged('task/123', 'main', '/repo', true)

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('git fetch failed'))
    expect(result).toBe(true)
    void CliError // imported for type completeness
  })

  it('does not emit a fetch warning when fetchFirst is false', async () => {
    const { branchFullyMerged } = await import('../../src/worktree/validate.js')
    mockRunCli.mockReturnValue({ stdout: '', stderr: '', exitCode: 0 })

    branchFullyMerged('task/123', 'main', '/repo', false)

    const fetchWarnings = (stderrSpy.mock.calls as unknown[][])
      .flat()
      .filter((a) => typeof a === 'string' && a.includes('git fetch failed'))
    expect(fetchWarnings).toHaveLength(0)
  })

  it('returns false only for git merge-base exit code 1', async () => {
    const { branchFullyMerged } = await import('../../src/worktree/validate.js')
    const { CliError } = await import('../../src/utils/run-cli.js')
    mockRunCli.mockImplementation(() => {
      throw new CliError('not merged', 1)
    })

    expect(branchFullyMerged('task/123', 'main', '/repo', false)).toBe(false)
  })

  it('rethrows an unexpected merge-base failure instead of reporting a false merge result', async () => {
    const { branchFullyMerged } = await import('../../src/worktree/validate.js')
    const failure = new Error('origin/main is unknown')
    mockRunCli.mockImplementation(() => {
      throw failure
    })

    expect(() => branchFullyMerged('task/123', 'main', '/repo', false)).toThrow(failure)
  })
})

describe('workingTreeDirty', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('uses strict untracked-file detection by default and reports staged, unstaged, or untracked work', async () => {
    const { workingTreeDirty } = await import('../../src/worktree/validate.js')
    mockRunCli.mockReturnValue({ stdout: '?? scratch.txt\n', stderr: '', exitCode: 0 })

    expect(workingTreeDirty('/repo')).toBe(true)
    expect(mockRunCli).toHaveBeenCalledWith(
      'git',
      ['status', '--porcelain', '--untracked-files=all'],
      { cwd: '/repo' },
    )
  })

  it('uses lenient detection when explicitly excluding untracked local files', async () => {
    const { workingTreeDirty } = await import('../../src/worktree/validate.js')
    mockRunCli.mockReturnValue({ stdout: '   \n', stderr: '', exitCode: 0 })

    expect(workingTreeDirty('/repo', 'exclude')).toBe(false)
    expect(mockRunCli).toHaveBeenCalledWith(
      'git',
      ['status', '--porcelain', '--untracked-files=no'],
      { cwd: '/repo' },
    )
  })
})

describe('isRunningFromMainRepo', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-worktree-validate-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('distinguishes a main repository .git directory from a linked-worktree pointer and a non-repository', async () => {
    const { isRunningFromMainRepo } = await import('../../src/worktree/validate.js')

    expect(isRunningFromMainRepo(dir)).toBe(false)
    writeFileSync(join(dir, '.git'), 'gitdir: /elsewhere/.git/worktrees/task\n')
    expect(isRunningFromMainRepo(dir)).toBe(false)
    rmSync(join(dir, '.git'))
    mkdirSync(join(dir, '.git'))
    expect(isRunningFromMainRepo(dir)).toBe(true)
  })
})
