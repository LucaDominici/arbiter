// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

// Real implementations for path tests (paths.js is NOT mocked)
import { siblingWorktreePathFor, worktreeDirectoryName } from '../../src/worktree/paths.js'
import type { WorktreeLinkSpec } from '../../src/wizard/types.js'
import type { MaterializeResult } from '../../src/worktree/links.js'

// ---- Mocks — Vitest hoists these above all imports ----

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
    constructor(d: {
      cmd: string
      args: readonly string[]
      exitCode: number
      stdout: string
      stderr: string
      timedOut: boolean
      notFound: boolean
    }) {
      super(`Command failed: ${d.cmd}`)
      Object.assign(this, d)
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

// Import mocked modules — these get mock versions due to hoisting above
import { runCli } from '../../src/utils/run-cli.js'
import {
  isRunningFromMainRepo,
  workingTreeDirty,
  branchFullyMerged,
} from '../../src/worktree/validate.js'
import { materializeLink, checkLinkIntegrity } from '../../src/worktree/links.js'
import { runWorktreeOpen } from '../../src/commands/worktree.js'

const mockRunCli = vi.mocked(runCli)
const mockMaterializeLink = vi.mocked(materializeLink)
const mockCheckLinkIntegrity = vi.mocked(checkLinkIntegrity)
const mockIsRunningFromMainRepo = vi.mocked(isRunningFromMainRepo)
const mockWorkingTreeDirty = vi.mocked(workingTreeDirty)
const mockBranchFullyMerged = vi.mocked(branchFullyMerged)

function ok(stdout: string) {
  return { stdout, stderr: '', exitCode: 0, durationMs: 1 }
}

// ---- path helpers ----

describe('siblingWorktreePathFor', () => {
  it('places worktree at <parent>/<repoName>.worktrees/<slug>', async () => {
    const gitRoot = '/home/user/projects/my-app'
    const result = siblingWorktreePathFor(gitRoot, 'feature-x')
    expect(result).toBe('/home/user/projects/my-app.worktrees/feature-x')
  })

  it('uses provided slug verbatim (no sanitization at this layer)', async () => {
    const gitRoot = '/repos/arbiter'
    const result = siblingWorktreePathFor(gitRoot, '#699-brainstorm')
    expect(result).toBe('/repos/arbiter.worktrees/#699-brainstorm')
  })
})

describe('worktreeDirectoryName fallback for sibling slug', () => {
  it('produces a #-free taskId slug when no explicit sibling slug given (#1108)', async () => {
    const name = worktreeDirectoryName('#699')
    expect(name).toBe('699')
    expect(name).not.toContain('#')
  })
})

// ---- materializeLink non-symlink guard (real FS) ----
// links.js is mocked at the module level, so we use vi.importActual to get
// the real implementation for these filesystem-touching tests.

describe('materializeLink — non-symlink guard (red-team C1)', () => {
  let mainRepo: string
  let worktree: string
  let realMaterializeLink: (
    spec: WorktreeLinkSpec,
    mainRepoPath: string,
    worktreePath: string,
  ) => MaterializeResult

  beforeAll(async () => {
    const actual = await vi.importActual<typeof import('../../src/worktree/links.js')>(
      '../../src/worktree/links.js',
    )
    realMaterializeLink = actual.materializeLink
  })

  beforeEach(() => {
    mainRepo = mkdtempSync(join(tmpdir(), 'sibling-main-'))
    worktree = mkdtempSync(join(tmpdir(), 'sibling-wt-'))
  })

  afterEach(() => {
    rmSync(mainRepo, { recursive: true, force: true })
    rmSync(worktree, { recursive: true, force: true })
  })

  it('throws when a real file (not symlink) exists at dest', async () => {
    writeFileSync(join(mainRepo, '.env'), 'SECRET=1')
    writeFileSync(join(worktree, '.env'), 'FAKE=1')
    const spec: WorktreeLinkSpec = { path: '.env' }
    expect(() => realMaterializeLink(spec, mainRepo, worktree)).toThrow(/non-symlink/)
  })

  it('throws when a real directory (not symlink) exists at dest for directory type', async () => {
    mkdirSync(join(mainRepo, 'node_modules'), { recursive: true })
    mkdirSync(join(worktree, 'node_modules'), { recursive: true })
    const spec: WorktreeLinkSpec = { path: 'node_modules', type: 'directory' }
    expect(() => realMaterializeLink(spec, mainRepo, worktree)).toThrow(/non-symlink/)
  })

  it('succeeds idempotently when dest IS a symlink', async () => {
    writeFileSync(join(mainRepo, '.env'), 'SECRET=1')
    symlinkSync(join(mainRepo, '.env'), join(worktree, '.env'))
    const spec: WorktreeLinkSpec = { path: '.env' }
    const result = realMaterializeLink(spec, mainRepo, worktree)
    expect(result.result).toBe('LINKED')
  })

  it('.claude/ directory is NOT in DEFAULT sibling link set (loop guard)', async () => {
    // The DEFAULT_LINKS in worktree.ts must NOT include .claude/ to avoid
    // hook/analyzer loops when the worktree's .claude/ points back to main repo.
    const src = readFileSync(resolve(process.cwd(), 'src/commands/worktree.ts'), 'utf-8')
    // .claude/settings.local.json is OK (opt-in file), but .claude/ directory symlink is not
    const hasClaudeDir = /\{\s*path:\s*['"]\.claude\/['"].*type:\s*['"]directory['"]/s.test(src)
    expect(hasClaudeDir).toBe(false)
  })
})

// ---- runWorktreeOpen with --sibling flag ----

describe('runWorktreeOpen — --sibling flag placement', () => {
  let fakeGitRoot: string

  beforeEach(() => {
    fakeGitRoot = mkdtempSync(join(tmpdir(), 'sibling-git-'))
    vi.resetAllMocks()
    // Re-establish return values cleared by resetAllMocks
    mockMaterializeLink.mockReturnValue({ result: 'LINKED' })
    mockCheckLinkIntegrity.mockReturnValue([])
    mockIsRunningFromMainRepo.mockReturnValue(true)
    mockWorkingTreeDirty.mockReturnValue(false)
    mockBranchFullyMerged.mockReturnValue(true)
  })

  afterEach(() => {
    rmSync(fakeGitRoot, { recursive: true, force: true })
  })

  it('places worktree at sibling path when --sibling is given', async () => {
    mockRunCli
      .mockReturnValueOnce(ok(fakeGitRoot)) // getGitRoot
      .mockReturnValueOnce(ok('')) // resolveEffectiveBase verify local
      .mockReturnValueOnce(ok('abc123')) // baseRef
      .mockReturnValueOnce(ok('')) // git worktree add

    const siblingSlug = 'my-feature'

    await runWorktreeOpen({
      taskId: '#698',
      cwd: fakeGitRoot,
      sibling: siblingSlug,
      json: true,
    })

    const wtAddCall = mockRunCli.mock.calls.find((c) => c[1]?.includes('worktree'))
    expect(wtAddCall).toBeDefined()
    const pathArg = wtAddCall?.[1]?.find((a) => a.includes('.worktrees'))
    expect(pathArg).toContain(siblingSlug)
  })
})

describe('runWorktreeOpen — default placement unchanged without --sibling', () => {
  let fakeGitRoot: string

  beforeEach(() => {
    fakeGitRoot = mkdtempSync(join(tmpdir(), 'default-git-'))
    vi.resetAllMocks()
    // Re-establish return values cleared by resetAllMocks
    mockMaterializeLink.mockReturnValue({ result: 'LINKED' })
    mockCheckLinkIntegrity.mockReturnValue([])
    mockIsRunningFromMainRepo.mockReturnValue(true)
    mockWorkingTreeDirty.mockReturnValue(false)
    mockBranchFullyMerged.mockReturnValue(true)
  })

  afterEach(() => {
    rmSync(fakeGitRoot, { recursive: true, force: true })
  })

  it('uses normal worktree base when --sibling not given', async () => {
    mockRunCli
      .mockReturnValueOnce(ok(fakeGitRoot))
      .mockReturnValueOnce(ok(''))
      .mockReturnValueOnce(ok('abc123'))
      .mockReturnValueOnce(ok(''))

    await runWorktreeOpen({ taskId: '#698', cwd: fakeGitRoot, json: true })

    const wtAddCall = mockRunCli.mock.calls.find((c) => c[1]?.includes('worktree'))
    expect(wtAddCall).toBeDefined()
    const pathArg = wtAddCall?.[1]?.find((a) => a.includes('.worktrees'))
    // #1108: worktree DIR is #-free (the git branch keeps #, asserted elsewhere).
    expect(pathArg).toContain('698')
    expect(pathArg).not.toContain('#')
    expect(pathArg).not.toContain('undefined')
  })
})
