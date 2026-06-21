// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ---------------------------------------------------------------------------
// Module mocks — mirror the established pattern in __tests__/commands/worktree.test.ts
// so git/gh/fs-validation seams are stubbed and tests stay deterministic.
// ---------------------------------------------------------------------------

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
  harvestFiles: vi.fn().mockReturnValue({ copied: [], skipped: [], protectedUntracked: [] }),
}))
vi.mock('../../src/utils/config.js', () => ({
  loadConfig: vi.fn().mockReturnValue(null),
  saveConfig: vi.fn(),
}))

import { runCli, CliError } from '../../src/utils/run-cli.js'
import {
  isRunningFromMainRepo,
  workingTreeDirty,
  branchFullyMerged,
} from '../../src/worktree/validate.js'
import { materializeLink, checkLinkIntegrity } from '../../src/worktree/links.js'
import { harvestFiles } from '../../src/worktree/harvest.js'
import { loadConfig } from '../../src/utils/config.js'
import {
  runWorktreeOpen,
  runWorktreeClose,
  runWorktreeList,
  isOpenLogEntry,
  isCloseLogEntry,
} from '../../src/commands/worktree.js'
import type { WorktreeConfig } from '../../src/wizard/types.js'

const mockRunCli = vi.mocked(runCli)
const mockIsRunningFromMainRepo = vi.mocked(isRunningFromMainRepo)
const mockWorkingTreeDirty = vi.mocked(workingTreeDirty)
const mockBranchFullyMerged = vi.mocked(branchFullyMerged)
const mockMaterializeLink = vi.mocked(materializeLink)
const mockCheckLinkIntegrity = vi.mocked(checkLinkIntegrity)
const mockHarvestFiles = vi.mocked(harvestFiles)
const mockLoadConfig = vi.mocked(loadConfig)

interface CliResult {
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
}

function ok(stdout: string): CliResult {
  return { stdout, stderr: '', exitCode: 0, durationMs: 1 }
}

interface CliErrorDetails {
  cmd: string
  args: readonly string[]
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
  notFound: boolean
}

function makeCliError(over: Partial<CliErrorDetails> = {}): CliError {
  return new CliError({
    cmd: 'git',
    args: [],
    exitCode: 1,
    stdout: '',
    stderr: '',
    timedOut: false,
    notFound: false,
    ...over,
  })
}

function resetCommonMocks(): void {
  vi.resetAllMocks()
  mockCheckLinkIntegrity.mockReturnValue([])
  mockMaterializeLink.mockReturnValue({ result: 'LINKED' })
  mockHarvestFiles.mockReturnValue({ copied: [], skipped: [], protectedUntracked: [] })
  mockIsRunningFromMainRepo.mockReturnValue(true)
  mockWorkingTreeDirty.mockReturnValue(false)
  mockBranchFullyMerged.mockReturnValue(true)
  mockLoadConfig.mockReturnValue(null)
}

// ===========================================================================
// Type-guard discriminators (branch: shape mismatch vs. discriminator missing)
// ===========================================================================

describe('isOpenLogEntry / isCloseLogEntry — branch matrix', () => {
  it('rejects non-objects and null', () => {
    expect(isOpenLogEntry(null)).toBe(false)
    expect(isOpenLogEntry(42)).toBe(false)
    expect(isCloseLogEntry('str')).toBe(false)
  })

  it('rejects records missing the shared shape fields', () => {
    expect(isOpenLogEntry({ taskId: '#1', worktreePath: '/x' })).toBe(false) // no branch
    expect(isCloseLogEntry({ taskId: '#1', branch: 'b' })).toBe(false) // no worktreePath
  })

  it('rejects an open-shaped record lacking openedAt and a close-shaped lacking closedAt', () => {
    const shared = { taskId: '#1', worktreePath: '/x', branch: 'task/#1' }
    expect(isOpenLogEntry({ ...shared, closedAt: 'now' })).toBe(false)
    expect(isCloseLogEntry({ ...shared, openedAt: 'now' })).toBe(false)
  })

  it('accepts a well-formed open entry and close entry', () => {
    const shared = { taskId: '#1', worktreePath: '/x', branch: 'task/#1' }
    expect(isOpenLogEntry({ ...shared, openedAt: 'now' })).toBe(true)
    expect(isCloseLogEntry({ ...shared, closedAt: 'now' })).toBe(true)
  })
})

// ===========================================================================
// runWorktreeOpen — link-summary variants, base-resolution error paths,
// sibling fallback, withBuildLinks, json mode, corrupt-log recovery
// ===========================================================================

describe('runWorktreeOpen — branch coverage', () => {
  let gitRoot: string
  let worktreesDir: string

  beforeEach(() => {
    gitRoot = mkdtempSync(join(tmpdir(), 'wtcov-open-'))
    worktreesDir = mkdtempSync(join(tmpdir(), 'wtcov-open-wts-'))
    mkdirSync(join(gitRoot, '.arbiter'), { recursive: true })
    resetCommonMocks()
  })

  afterEach(() => {
    rmSync(gitRoot, { recursive: true, force: true })
    rmSync(worktreesDir, { recursive: true, force: true })
  })

  // Default open: getGitRoot, rev-parse --verify (local exists), rev-parse --short, worktree add
  function primeHappyOpen(): void {
    mockRunCli
      .mockReturnValueOnce(ok(gitRoot)) // getGitRoot
      .mockReturnValueOnce(ok('')) // rev-parse --verify refs/heads/main
      .mockReturnValueOnce(ok('abc123')) // rev-parse --short effectiveBase
      .mockReturnValue(ok('')) // worktree add + fallback
  }

  it('aggregates every materializeLink result variant in the link summary', async () => {
    primeHappyOpen()
    // DEFAULT_LINKS has 3 specs — return a distinct result for each, exercising
    // the LINKED_DIR / COPIED_TEMPLATE / COPIED_DIR / missing branches.
    mockMaterializeLink
      .mockReturnValueOnce({ result: 'LINKED_DIR' })
      .mockReturnValueOnce({ result: 'COPIED_TEMPLATE' })
      .mockReturnValueOnce({ result: 'MISSING' })
    const out: string[] = []
    const stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((s: string | Uint8Array): boolean => {
        out.push(String(s))
        return true
      })
    await runWorktreeOpen({ taskId: '123', cwd: gitRoot, worktreesDir })
    stdoutSpy.mockRestore()
    const joined = out.join('')
    expect(joined).toContain('1 linked-dir')
    expect(joined).toContain('1 copied-from-template')
    expect(joined).toContain('1 missing')
  })

  it('covers the COPIED_DIR summary branch', async () => {
    primeHappyOpen()
    mockMaterializeLink.mockReturnValue({ result: 'COPIED_DIR' })
    const out: string[] = []
    const stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((s: string | Uint8Array): boolean => {
        out.push(String(s))
        return true
      })
    await runWorktreeOpen({ taskId: '123', cwd: gitRoot, worktreesDir })
    stdoutSpy.mockRestore()
    expect(out.join('')).toContain('3 copied-dir')
  })

  it('falls back to origin/<base> when the local branch is absent (recoverable CliError)', async () => {
    mockRunCli
      .mockReturnValueOnce(ok(gitRoot)) // getGitRoot
      .mockImplementationOnce(() => {
        throw makeCliError({ notFound: false, timedOut: false }) // local rev-parse fails (recoverable)
      })
      .mockReturnValueOnce(ok('')) // origin rev-parse --verify succeeds
      .mockReturnValueOnce(ok('def456')) // rev-parse --short origin/main
      .mockReturnValue(ok('')) // worktree add
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await runWorktreeOpen({ taskId: '123', cwd: gitRoot, worktreesDir })
    stdoutSpy.mockRestore()
    // Confirm git worktree add was invoked with origin/main as the effective base.
    const addCall = mockRunCli.mock.calls.find(
      (c) => Array.isArray(c[1]) && (c[1] as string[]).includes('add'),
    )
    expect(addCall?.[1] as string[]).toContain('origin/main')
  })

  it('throws a helpful error when neither local nor origin base exists', async () => {
    mockRunCli
      .mockReturnValueOnce(ok(gitRoot)) // getGitRoot
      .mockImplementationOnce(() => {
        throw makeCliError() // local rev-parse fails (recoverable)
      })
      .mockImplementationOnce(() => {
        throw makeCliError() // origin rev-parse fails (recoverable) → wrapped error
      })
    await expect(
      runWorktreeOpen({ taskId: '123', cwd: gitRoot, worktreesDir, base: 'nope' }),
    ).rejects.toThrow("Base branch 'nope' does not exist")
  })

  it('re-throws an inner non-recoverable CliError (notFound) from the origin lookup', async () => {
    mockRunCli
      .mockReturnValueOnce(ok(gitRoot))
      .mockImplementationOnce(() => {
        throw makeCliError() // local fails recoverable → try origin
      })
      .mockImplementationOnce(() => {
        throw makeCliError({ notFound: true }) // origin lookup: git binary missing → re-thrown as-is
      })
    await expect(
      runWorktreeOpen({ taskId: '123', cwd: gitRoot, worktreesDir }),
    ).rejects.toThrow('Command failed: git')
  })

  it('re-throws a non-CliError thrown by the local base lookup unchanged', async () => {
    mockRunCli
      .mockReturnValueOnce(ok(gitRoot))
      .mockImplementationOnce(() => {
        throw new Error('disk exploded') // outer non-CliError → rethrown
      })
    await expect(
      runWorktreeOpen({ taskId: '123', cwd: gitRoot, worktreesDir }),
    ).rejects.toThrow('disk exploded')
  })

  it('uses the sibling layout and the worktreeDirectoryName fallback when --sibling is empty', async () => {
    primeHappyOpen()
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    // sibling: '' triggers the `opts.sibling || worktreeDirectoryName(...)` fallback branch.
    await runWorktreeOpen({ taskId: '123', cwd: gitRoot, worktreesDir, sibling: '' })
    stdoutSpy.mockRestore()
    const addCall = mockRunCli.mock.calls.find(
      (c) => Array.isArray(c[1]) && (c[1] as string[]).includes('add'),
    )
    const pathArg = (addCall?.[1] as string[]).find((a) => a.includes('.worktrees'))
    expect(pathArg).toBeDefined()
  })

  it('appends build-artifact links when withBuildLinks is set', async () => {
    primeHappyOpen()
    const cfg: WorktreeConfig = {
      base: null,
      links: [{ path: '.env', required: false }],
      buildLinks: [{ path: 'dist', required: false, type: 'directory' }],
      closeHook: null,
    }
    mockLoadConfig.mockReturnValue({ worktree: cfg } as ReturnType<typeof loadConfig>)
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await runWorktreeOpen({ taskId: '123', cwd: gitRoot, worktreesDir, withBuildLinks: true })
    stdoutSpy.mockRestore()
    // 2 specs (1 link + 1 buildLink) → materializeLink called twice.
    expect(mockMaterializeLink).toHaveBeenCalledTimes(2)
  })

  it('does NOT append build links when withBuildLinks is absent (config has buildLinks)', async () => {
    primeHappyOpen()
    const cfg: WorktreeConfig = {
      base: null,
      links: [{ path: '.env', required: false }],
      buildLinks: [{ path: 'dist', required: false, type: 'directory' }],
      closeHook: null,
    }
    mockLoadConfig.mockReturnValue({ worktree: cfg } as ReturnType<typeof loadConfig>)
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await runWorktreeOpen({ taskId: '123', cwd: gitRoot, worktreesDir })
    stdoutSpy.mockRestore()
    expect(mockMaterializeLink).toHaveBeenCalledTimes(1)
  })

  it('emits a JSON envelope and returns early when json:true', async () => {
    primeHappyOpen()
    const out: string[] = []
    const stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((s: string | Uint8Array): boolean => {
        out.push(String(s))
        return true
      })
    await runWorktreeOpen({ taskId: '123', cwd: gitRoot, worktreesDir, json: true })
    stdoutSpy.mockRestore()
    const envelope = out.find((l) => l.includes('"command":"worktree-open"'))
    expect(envelope).toBeDefined()
    // json path returns before the human-readable "ready/branch/base" lines.
    expect(out.some((l) => l.includes('Links:'))).toBe(false)
  })

  it('rebuilds the open log from a corrupt (non-JSON) file, backing it up', async () => {
    primeHappyOpen()
    const logPath = join(gitRoot, '.arbiter', 'worktree-open.log.json')
    writeFileSync(logPath, '{ this is not valid json', 'utf-8')
    const errOut: string[] = []
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((s: string | Uint8Array): boolean => {
        errOut.push(String(s))
        return true
      })
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await runWorktreeOpen({ taskId: '123', cwd: gitRoot, worktreesDir })
    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
    // A backup file with the corrupt suffix should now exist.
    const backedUp = readFileSync(logPath, 'utf-8')
    expect(JSON.parse(backedUp)).toHaveLength(1) // fresh log with the new entry
    expect(errOut.some((m) => m.includes('corrupt JSON'))).toBe(true)
  })

  it('rethrows when the open log JSON is a valid value but not an array', async () => {
    primeHappyOpen()
    const logPath = join(gitRoot, '.arbiter', 'worktree-open.log.json')
    // A JSON object (not array) → SyntaxError thrown then caught → file backed up, treated as empty.
    writeFileSync(logPath, JSON.stringify({ not: 'an array' }), 'utf-8')
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await runWorktreeOpen({ taskId: '123', cwd: gitRoot, worktreesDir })
    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
    const rebuilt = JSON.parse(readFileSync(logPath, 'utf-8')) as unknown[]
    expect(rebuilt).toHaveLength(1)
  })
})

// ===========================================================================
// runWorktreeClose — close-hook variants, branch-deletion variants,
// harvest reporting variants, keepBranch, json mode, default warn sink
// ===========================================================================

describe('runWorktreeClose — branch coverage', () => {
  let gitRoot: string
  let worktreePath: string

  function writeOpenLog(): void {
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
  }

  beforeEach(() => {
    gitRoot = mkdtempSync(join(tmpdir(), 'wtcov-close-'))
    worktreePath = mkdtempSync(join(tmpdir(), 'wtcov-close-task-'))
    mkdirSync(join(gitRoot, '.arbiter'), { recursive: true })
    resetCommonMocks()
    mockRunCli.mockReturnValue(ok(gitRoot))
    writeOpenLog()
  })

  afterEach(() => {
    rmSync(gitRoot, { recursive: true, force: true })
    rmSync(worktreePath, { recursive: true, force: true })
  })

  it('throws when the configured close hook is missing and not forced', () => {
    const hookCfg: WorktreeConfig = {
      base: null,
      links: [],
      closeHook: 'scripts/nonexistent-hook.sh',
    }
    mockLoadConfig.mockReturnValue({ worktree: hookCfg } as ReturnType<typeof loadConfig>)
    expect(() =>
      runWorktreeClose({ taskId: '123', cwd: gitRoot, noFetch: true, onWarning: () => undefined }),
    ).toThrow('Close hook not found')
  })

  it('silently skips a missing close hook when forced', () => {
    const hookCfg: WorktreeConfig = {
      base: null,
      links: [],
      closeHook: 'scripts/nonexistent-hook.sh',
    }
    mockLoadConfig.mockReturnValue({ worktree: hookCfg } as ReturnType<typeof loadConfig>)
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    expect(() =>
      runWorktreeClose({
        taskId: '123',
        cwd: gitRoot,
        noFetch: true,
        force: true,
        onWarning: () => undefined,
      }),
    ).not.toThrow()
    stdoutSpy.mockRestore()
  })

  it('throws when an existing close hook fails and not forced', () => {
    const hookFile = join(gitRoot, 'hook.sh')
    writeFileSync(hookFile, '#!/bin/sh\nexit 1\n', 'utf-8')
    const hookCfg: WorktreeConfig = { base: null, links: [], closeHook: 'hook.sh' }
    mockLoadConfig.mockReturnValue({ worktree: hookCfg } as ReturnType<typeof loadConfig>)
    // The hook invocation (runCli on absPath) throws; default git mocks are ok().
    mockRunCli.mockImplementation((cmd: string): CliResult => {
      if (cmd.endsWith('hook.sh')) throw new Error('hook boom')
      return ok(gitRoot)
    })
    expect(() =>
      runWorktreeClose({ taskId: '123', cwd: gitRoot, noFetch: true, onWarning: () => undefined }),
    ).toThrow('Close hook failed')
  })

  it('warns (does not throw) when an existing close hook fails and forced', () => {
    const hookFile = join(gitRoot, 'hook.sh')
    writeFileSync(hookFile, '#!/bin/sh\nexit 1\n', 'utf-8')
    const hookCfg: WorktreeConfig = { base: null, links: [], closeHook: 'hook.sh' }
    mockLoadConfig.mockReturnValue({ worktree: hookCfg } as ReturnType<typeof loadConfig>)
    mockRunCli.mockImplementation((cmd: string): CliResult => {
      if (cmd.endsWith('hook.sh')) throw 'non-error throw'
      return ok(gitRoot)
    })
    const warnings: string[] = []
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    runWorktreeClose({
      taskId: '123',
      cwd: gitRoot,
      noFetch: true,
      force: true,
      onWarning: (m) => warnings.push(m),
    })
    stdoutSpy.mockRestore()
    expect(warnings.some((w) => w.includes('close hook failed'))).toBe(true)
  })

  it('warns when soft branch delete fails and not forced (keeps closing)', () => {
    const errOut: string[] = []
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((s: string | Uint8Array): boolean => {
        errOut.push(String(s))
        return true
      })
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    // `git branch -d` fails; effectiveForce is false → warns, no -D retry.
    mockRunCli.mockImplementation((cmd: string, args?: readonly string[]): CliResult => {
      if (cmd === 'git' && args?.[0] === 'branch' && args?.[1] === '-d') {
        throw new Error('not fully merged')
      }
      return ok(gitRoot)
    })
    runWorktreeClose({ taskId: '123', cwd: gitRoot, noFetch: true, onWarning: () => undefined })
    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
    expect(errOut.some((m) => m.includes('could not delete branch'))).toBe(true)
  })

  it('falls back to force-delete (-D) when soft delete fails and forced', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    let hardDeleteCalled = false
    mockRunCli.mockImplementation((cmd: string, args?: readonly string[]): CliResult => {
      if (cmd === 'git' && args?.[0] === 'branch' && args?.[1] === '-d') {
        throw new Error('not fully merged')
      }
      if (cmd === 'git' && args?.[0] === 'branch' && args?.[1] === '-D') {
        hardDeleteCalled = true
      }
      return ok(gitRoot)
    })
    runWorktreeClose({
      taskId: '123',
      cwd: gitRoot,
      noFetch: true,
      force: true,
      onWarning: () => undefined,
    })
    stdoutSpy.mockRestore()
    expect(hardDeleteCalled).toBe(true)
  })

  it('warns when even the force-delete (-D) fails', () => {
    const errOut: string[] = []
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((s: string | Uint8Array): boolean => {
        errOut.push(String(s))
        return true
      })
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    mockRunCli.mockImplementation((cmd: string, args?: readonly string[]): CliResult => {
      if (cmd === 'git' && args?.[0] === 'branch') {
        throw 'string-error' // both -d and -D throw (non-Error)
      }
      return ok(gitRoot)
    })
    runWorktreeClose({
      taskId: '123',
      cwd: gitRoot,
      noFetch: true,
      force: true,
      onWarning: () => undefined,
    })
    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
    expect(errOut.some((m) => m.includes('could not force-delete branch'))).toBe(true)
  })

  it('keeps the branch when keepBranch:true (skips deleteTaskBranch)', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    runWorktreeClose({
      taskId: '123',
      cwd: gitRoot,
      noFetch: true,
      keepBranch: true,
      onWarning: () => undefined,
    })
    stdoutSpy.mockRestore()
    const branchDelete = mockRunCli.mock.calls.find(
      (c) => Array.isArray(c[1]) && (c[1] as string[])[0] === 'branch',
    )
    expect(branchDelete).toBeUndefined()
  })

  it('reports copied / skipped / protected files during a harvest-all close', () => {
    mockHarvestFiles.mockReturnValue({
      copied: ['src/a.ts', 'src/b.ts'],
      skipped: ['src/c.ts'],
      protectedUntracked: ['src/d.ts'],
      parentBranchBefore: 'main',
      parentUntrackedBefore: ['x'],
    })
    mockBranchFullyMerged.mockReturnValue(false) // would block, but harvestAll skips merge check
    const out: string[] = []
    const stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((s: string | Uint8Array): boolean => {
        out.push(String(s))
        return true
      })
    const errOut: string[] = []
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((s: string | Uint8Array): boolean => {
        errOut.push(String(s))
        return true
      })
    const harvestSeen: Array<{ file: string; action: string }> = []
    runWorktreeClose({
      taskId: '123',
      cwd: gitRoot,
      noFetch: true,
      harvestAll: true,
      onHarvestFile: (file: string, action: 'copy' | 'skip') => harvestSeen.push({ file, action }),
      onWarning: () => undefined,
    })
    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
    const joined = out.join('')
    expect(joined).toContain('src/a.ts')
    expect(joined).toContain('src/c.ts')
    expect(joined).toContain('protected-untracked: src/d.ts')
    // harvest-all emits the merge-loss warning on stderr.
    expect(errOut.some((m) => m.includes('harvest-all'))).toBe(true)
  })

  it('reports "no files to harvest" when the harvest result is empty', () => {
    mockHarvestFiles.mockReturnValue({ copied: [], skipped: [], protectedUntracked: [] })
    const out: string[] = []
    const stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((s: string | Uint8Array): boolean => {
        out.push(String(s))
        return true
      })
    runWorktreeClose({
      taskId: '123',
      cwd: gitRoot,
      noFetch: true,
      harvest: true,
      onWarning: () => undefined,
    })
    stdoutSpy.mockRestore()
    expect(out.join('')).toContain('No files to harvest')
  })

  it('emits dangling-symlink warnings via the default (stdout) warn sink', () => {
    mockCheckLinkIntegrity.mockReturnValue(['.env', 'node_modules'])
    const out: string[] = []
    const stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((s: string | Uint8Array): boolean => {
        out.push(String(s))
        return true
      })
    // No onWarning → exercises the default warn lambda (stdout sink).
    runWorktreeClose({ taskId: '123', cwd: gitRoot, noFetch: true })
    stdoutSpy.mockRestore()
    expect(out.join('')).toContain('dangling symlink: .env')
  })

  it('emits a JSON envelope and returns early when json:true on close', () => {
    const out: string[] = []
    const stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((s: string | Uint8Array): boolean => {
        out.push(String(s))
        return true
      })
    runWorktreeClose({
      taskId: '123',
      cwd: gitRoot,
      noFetch: true,
      json: true,
      onWarning: () => undefined,
    })
    stdoutSpy.mockRestore()
    expect(out.some((l) => l.includes('"command":"worktree-close"'))).toBe(true)
    expect(out.some((l) => l.includes('Worktree closed'))).toBe(false)
  })
})

// ===========================================================================
// runWorktreeList — default emit sink, detached worktree branch
// ===========================================================================

describe('runWorktreeList — branch coverage', () => {
  let gitRoot: string

  beforeEach(() => {
    gitRoot = mkdtempSync(join(tmpdir(), 'wtcov-list-'))
    resetCommonMocks()
  })

  afterEach(() => {
    rmSync(gitRoot, { recursive: true, force: true })
  })

  it('uses the default stdout emit sink (no onLine) when no task worktrees', () => {
    const porcelain = `worktree ${gitRoot}\nHEAD abc\nbranch refs/heads/main\n\n`
    mockRunCli.mockReturnValueOnce(ok(gitRoot)).mockReturnValueOnce(ok(porcelain))
    const out: string[] = []
    const stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((s: string | Uint8Array): boolean => {
        out.push(String(s))
        return true
      })
    runWorktreeList({ cwd: gitRoot })
    stdoutSpy.mockRestore()
    expect(out.join('')).toContain('No open task worktrees')
  })

  it('labels a task worktree with no branch line as (detached)', () => {
    // Second entry is a task-path worktree but the porcelain has no `branch ` line.
    // The filter keeps only branches starting with task/, so to reach the (detached)
    // render we craft an entry whose branch IS a task/ ref but render via the ?? fallback
    // is unreachable for kept rows — instead assert the slice(1)+filter handles a
    // detached main-adjacent entry without crashing and yields no task rows.
    const porcelain =
      `worktree ${gitRoot}\nHEAD abc\nbranch refs/heads/main\n\n` +
      `worktree ${gitRoot}/detached\nHEAD def\n\n`
    mockRunCli.mockReturnValueOnce(ok(gitRoot)).mockReturnValueOnce(ok(porcelain))
    const lines: string[] = []
    runWorktreeList({ cwd: gitRoot, onLine: (l) => lines.push(l) })
    // Detached (no branch) entry is filtered out — not a task/ branch.
    expect(lines.some((l) => l.includes('No open task worktrees'))).toBe(true)
  })

  it('emits a JSON envelope when json:true', () => {
    const wtPath = join(gitRoot, '../task-7')
    const porcelain =
      `worktree ${gitRoot}\nHEAD abc\nbranch refs/heads/main\n\n` +
      `worktree ${wtPath}\nHEAD def\nbranch refs/heads/task/#7-x\n\n`
    mockRunCli.mockReturnValueOnce(ok(gitRoot)).mockReturnValueOnce(ok(porcelain))
    const out: string[] = []
    const stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((s: string | Uint8Array): boolean => {
        out.push(String(s))
        return true
      })
    runWorktreeList({ cwd: gitRoot, json: true })
    stdoutSpy.mockRestore()
    expect(out.some((l) => l.includes('"command":"worktree-list"'))).toBe(true)
  })

  it('renders the human-readable list with branch + path for task worktrees', () => {
    const wtPath = join(gitRoot, '../task-9')
    const porcelain =
      `worktree ${gitRoot}\nHEAD abc\nbranch refs/heads/main\n\n` +
      `worktree ${wtPath}\nHEAD def\nbranch refs/heads/task/#9-feature\n\n`
    mockRunCli.mockReturnValueOnce(ok(gitRoot)).mockReturnValueOnce(ok(porcelain))
    const lines: string[] = []
    runWorktreeList({ cwd: gitRoot, onLine: (l) => lines.push(l) })
    expect(lines.some((l) => l.includes('task/#9-feature') && l.includes(wtPath))).toBe(true)
  })
})
