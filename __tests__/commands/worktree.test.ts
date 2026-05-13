import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('../../src/utils/run-cli.js', () => ({
  runCli: vi.fn(),
  CliError: class CliError extends Error {
    cmd: string
    args: readonly string[]
    exitCode: number
    stdout: string
    stderr: string
    timedOut: boolean
    notFound: boolean
    constructor(details: {
      cmd: string
      args: readonly string[]
      exitCode: number
      stdout: string
      stderr: string
      timedOut: boolean
      notFound: boolean
    }) {
      super(`Command failed: ${details.cmd}`)
      this.name = 'CliError'
      this.cmd = details.cmd
      this.args = details.args
      this.exitCode = details.exitCode
      this.stdout = details.stdout
      this.stderr = details.stderr
      this.timedOut = details.timedOut
      this.notFound = details.notFound
    }
  },
}))
vi.mock('../../src/worktree/validate.js', () => ({
  isRunningFromMainRepo: vi.fn().mockReturnValue(true),
  workingTreeDirty: vi.fn().mockReturnValue(false),
  branchFullyMerged: vi.fn().mockReturnValue(true),
}))
vi.mock('../../src/worktree/links.js', () => ({
  materializeLink: vi.fn().mockReturnValue({ result: 'LINKED' }),
  checkLinkIntegrity: vi.fn().mockReturnValue([]),
}))
vi.mock('../../src/worktree/harvest.js', () => ({
  harvestFiles: vi.fn().mockReturnValue({ copied: [], skipped: [] }),
}))
vi.mock('../../src/utils/config.js', () => ({
  loadConfig: vi.fn().mockReturnValue(null),
  saveConfig: vi.fn(),
}))

import { runCli } from '../../src/utils/run-cli.js'
import {
  isRunningFromMainRepo,
  workingTreeDirty,
  branchFullyMerged,
} from '../../src/worktree/validate.js'
import { materializeLink, checkLinkIntegrity } from '../../src/worktree/links.js'
import { harvestFiles } from '../../src/worktree/harvest.js'

const mockRunCli = vi.mocked(runCli)
const mockIsRunningFromMainRepo = vi.mocked(isRunningFromMainRepo)
const mockWorkingTreeDirty = vi.mocked(workingTreeDirty)
const mockBranchFullyMerged = vi.mocked(branchFullyMerged)
const mockMaterializeLink = vi.mocked(materializeLink)
const mockCheckLinkIntegrity = vi.mocked(checkLinkIntegrity)
const mockHarvestFiles = vi.mocked(harvestFiles)

function ok(stdout: string) {
  return { stdout, stderr: '', exitCode: 0, durationMs: 1 }
}

describe('runWorktreeList', () => {
  let gitRoot: string

  beforeEach(() => {
    gitRoot = mkdtempSync(join(tmpdir(), 'arbiter-wt-list-'))
    vi.resetAllMocks()
    mockCheckLinkIntegrity.mockReturnValue([])
    mockMaterializeLink.mockReturnValue({ result: 'LINKED' })
    mockHarvestFiles.mockReturnValue({ copied: [], skipped: [] })
    mockRunCli.mockReturnValue(ok(gitRoot))
  })

  afterEach(() => {
    rmSync(gitRoot, { recursive: true, force: true })
  })

  it("emits 'No open task worktrees' when list is empty (main only)", async () => {
    const porcelain = `worktree ${gitRoot}\nHEAD abc123\nbranch refs/heads/main\n\n`
    mockRunCli.mockReturnValueOnce(ok(gitRoot)).mockReturnValueOnce(ok(porcelain))

    const lines: string[] = []
    const { runWorktreeList } = await import('../../src/commands/worktree.js')
    runWorktreeList({ cwd: gitRoot, onLine: (l) => lines.push(l) })

    expect(lines.some((l) => l.includes('No open task worktrees'))).toBe(true)
  })

  it('lists task worktrees from porcelain output', async () => {
    const wtPath = join(gitRoot, '../task-123')
    const porcelain =
      `worktree ${gitRoot}\nHEAD abc123\nbranch refs/heads/main\n\n` +
      `worktree ${wtPath}\nHEAD def456\nbranch refs/heads/task/#123-my-feature\n\n`
    mockRunCli.mockReturnValueOnce(ok(gitRoot)).mockReturnValueOnce(ok(porcelain))

    const lines: string[] = []
    const { runWorktreeList } = await import('../../src/commands/worktree.js')
    runWorktreeList({ cwd: gitRoot, onLine: (l) => lines.push(l) })

    expect(lines.some((l) => l.includes('task/#123-my-feature'))).toBe(true)
    expect(lines.some((l) => l.includes('Open task worktrees (1)'))).toBe(true)
  })

  it('ignores non-task branches in the list', async () => {
    const wtPath = join(gitRoot, '../feat-branch')
    const porcelain =
      `worktree ${gitRoot}\nHEAD abc123\nbranch refs/heads/main\n\n` +
      `worktree ${wtPath}\nHEAD def456\nbranch refs/heads/feat/something\n\n`
    mockRunCli.mockReturnValueOnce(ok(gitRoot)).mockReturnValueOnce(ok(porcelain))

    const lines: string[] = []
    const { runWorktreeList } = await import('../../src/commands/worktree.js')
    runWorktreeList({ cwd: gitRoot, onLine: (l) => lines.push(l) })

    expect(lines.some((l) => l.includes('No open task worktrees'))).toBe(true)
  })
})

describe('runWorktreeOpen', () => {
  let gitRoot: string
  let worktreesDir: string

  beforeEach(() => {
    gitRoot = mkdtempSync(join(tmpdir(), 'arbiter-wt-open-'))
    worktreesDir = mkdtempSync(join(tmpdir(), 'arbiter-wt-open-wts-'))
    mkdirSync(join(gitRoot, '.arbiter'), { recursive: true })
    vi.resetAllMocks()
    mockCheckLinkIntegrity.mockReturnValue([])
    mockMaterializeLink.mockReturnValue({ result: 'LINKED' })
    mockHarvestFiles.mockReturnValue({ copied: [], skipped: [] })
    mockIsRunningFromMainRepo.mockReturnValue(true)
    mockWorkingTreeDirty.mockReturnValue(false)
    mockRunCli
      .mockReturnValueOnce(ok(gitRoot)) // getGitRoot
      .mockReturnValueOnce(ok('')) // rev-parse --verify refs/heads/main (local branch exists)
      .mockReturnValueOnce(ok('abc123')) // rev-parse --short effectiveBase
      .mockReturnValueOnce(ok('')) // git worktree add
      .mockReturnValue(ok('')) // fallback
  })

  afterEach(() => {
    rmSync(gitRoot, { recursive: true, force: true })
    rmSync(worktreesDir, { recursive: true, force: true })
  })

  it('throws when not running from main repo', async () => {
    mockIsRunningFromMainRepo.mockReturnValue(false)
    const { runWorktreeOpen } = await import('../../src/commands/worktree.js')
    expect(() => runWorktreeOpen({ taskId: '123', cwd: gitRoot, worktreesDir })).toThrow(
      'Must run from the main repository',
    )
  })

  it('throws when working tree is dirty', async () => {
    mockWorkingTreeDirty.mockReturnValue(true)
    const { runWorktreeOpen } = await import('../../src/commands/worktree.js')
    expect(() => runWorktreeOpen({ taskId: '123', cwd: gitRoot, worktreesDir })).toThrow(
      'uncommitted changes',
    )
  })

  it('opens worktree and writes log entry on success', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { runWorktreeOpen } = await import('../../src/commands/worktree.js')
    runWorktreeOpen({ taskId: '123', cwd: gitRoot, worktreesDir })
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Worktree ready'))
    logSpy.mockRestore()
  })

  it('throws when worktree path already exists', async () => {
    const { worktreePathFor } = await import('../../src/worktree/paths.js')
    const { resolveWorktreeBase } = await import('../../src/worktree/paths.js')
    const base = resolveWorktreeBase(gitRoot, null, worktreesDir)
    const wt = worktreePathFor(base, '123', undefined)
    mkdirSync(wt, { recursive: true })

    const { runWorktreeOpen } = await import('../../src/commands/worktree.js')
    expect(() => runWorktreeOpen({ taskId: '123', cwd: gitRoot, worktreesDir })).toThrow(
      'Worktree already exists',
    )
  })
})

describe('runWorktreeClose', () => {
  let gitRoot: string
  let worktreePath: string

  beforeEach(() => {
    gitRoot = mkdtempSync(join(tmpdir(), 'arbiter-wt-close-'))
    worktreePath = mkdtempSync(join(tmpdir(), 'arbiter-wt-task-'))
    mkdirSync(join(gitRoot, '.arbiter'), { recursive: true })
    vi.resetAllMocks()
    mockCheckLinkIntegrity.mockReturnValue([])
    mockMaterializeLink.mockReturnValue({ result: 'LINKED' })
    mockHarvestFiles.mockReturnValue({ copied: [], skipped: [] })
    mockIsRunningFromMainRepo.mockReturnValue(true)
    mockWorkingTreeDirty.mockReturnValue(false)
    mockBranchFullyMerged.mockReturnValue(true)
    mockRunCli.mockReturnValue(ok(gitRoot))
    // Write a valid log entry — taskId must be in canonical #NNN form
    writeFileSync(
      join(gitRoot, '.arbiter', 'worktree-open.log.json'),
      JSON.stringify([
        {
          taskId: '#123',
          slug: null,
          worktreePath,
          branch: 'task/#123-test',
          baseBranch: 'main',
          baseRef: 'abc123',
          openedAt: new Date().toISOString(),
        },
      ]) + '\n',
    )
  })

  afterEach(() => {
    rmSync(gitRoot, { recursive: true, force: true })
    rmSync(worktreePath, { recursive: true, force: true })
  })

  it('throws when not running from main repo', async () => {
    mockIsRunningFromMainRepo.mockReturnValue(false)
    const { runWorktreeClose } = await import('../../src/commands/worktree.js')
    expect(() => runWorktreeClose({ taskId: '123', cwd: gitRoot, noFetch: true })).toThrow(
      "Must run 'worktree close' from the main repository",
    )
  })

  it('throws when no open worktree found for task', async () => {
    const { runWorktreeClose } = await import('../../src/commands/worktree.js')
    expect(() => runWorktreeClose({ taskId: '999', cwd: gitRoot, noFetch: true })).toThrow(
      'No open worktree found for task',
    )
  })

  it('throws when working tree has uncommitted changes without --force', async () => {
    mockWorkingTreeDirty.mockReturnValue(true)
    const { runWorktreeClose } = await import('../../src/commands/worktree.js')
    expect(() => runWorktreeClose({ taskId: '123', cwd: gitRoot, noFetch: true })).toThrow(
      'uncommitted changes',
    )
  })

  it('throws when branch not merged and force is false', async () => {
    mockBranchFullyMerged.mockReturnValue(false)
    const { runWorktreeClose } = await import('../../src/commands/worktree.js')
    expect(() => runWorktreeClose({ taskId: '123', cwd: gitRoot, noFetch: true })).toThrow(
      'has not been merged',
    )
  })

  it('closes successfully when branch is merged', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { runWorktreeClose } = await import('../../src/commands/worktree.js')
    runWorktreeClose({
      taskId: '123',
      cwd: gitRoot,
      noFetch: true,
      onWarning: () => undefined,
    })
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Worktree closed'))
    logSpy.mockRestore()
  })

  it('force-closes without merge check', async () => {
    mockBranchFullyMerged.mockReturnValue(false)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { runWorktreeClose } = await import('../../src/commands/worktree.js')
    runWorktreeClose({
      taskId: '123',
      cwd: gitRoot,
      noFetch: true,
      force: true,
      onWarning: () => undefined,
    })
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Worktree closed'))
    logSpy.mockRestore()
  })

  it('emits warning for stale log entry and throws', async () => {
    const staleWorktreePath = join(tmpdir(), 'nonexistent-wt-path-12345')
    writeFileSync(
      join(gitRoot, '.arbiter', 'worktree-open.log.json'),
      JSON.stringify([
        {
          taskId: '#456',
          slug: null,
          worktreePath: staleWorktreePath,
          branch: 'task/#456-stale',
          baseBranch: 'main',
          baseRef: 'xyz789',
          openedAt: new Date().toISOString(),
        },
      ]) + '\n',
    )
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const { runWorktreeClose } = await import('../../src/commands/worktree.js')
    expect(() => runWorktreeClose({ taskId: '456', cwd: gitRoot, noFetch: true })).toThrow(
      'No open worktree found',
    )
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Worktree directory missing'))
    stderrSpy.mockRestore()
  })

  it('skips corrupt log entries missing required fields (#326)', async () => {
    // Write a log with one corrupt entry (missing required fields) and one valid entry
    writeFileSync(
      join(gitRoot, '.arbiter', 'worktree-open.log.json'),
      JSON.stringify([
        { corruptEntry: true }, // missing taskId, worktreePath, branch
        {
          taskId: '#123',
          slug: null,
          worktreePath,
          branch: 'task/#123-test',
          baseBranch: 'main',
          baseRef: 'abc123',
          openedAt: new Date().toISOString(),
        },
      ]) + '\n',
    )
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { runWorktreeClose } = await import('../../src/commands/worktree.js')
    // Should not crash — corrupt entry is silently skipped, valid entry is found
    runWorktreeClose({
      taskId: '123',
      cwd: gitRoot,
      noFetch: true,
      onWarning: () => undefined,
    })
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Worktree closed'))
    logSpy.mockRestore()
  })
})
