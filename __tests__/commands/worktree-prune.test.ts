// SPDX-License-Identifier: Apache-2.0
// T5 of #1873 (M3): `arbiter worktree prune --stale [hours]` — the zombie
// reaper. Candidates come from the worktree-open log and must have a CLEAN
// tree AND (branch fully merged OR no activity within the threshold).
// A dirty tree is NEVER a candidate (INV-96). Dry-run is the default;
// --execute applies. Inactive-unmerged candidates keep their branch —
// committed work is never destroyed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('../../src/utils/run-cli.js', () => ({
  runCli: vi.fn(),
  CliError: class CliError extends Error {
    exitCode = 1
    notFound = false
    timedOut = false
  },
}))
vi.mock('../../src/worktree/validate.js', () => ({
  isRunningFromMainRepo: vi.fn().mockReturnValue(true),
  workingTreeDirty: vi.fn().mockReturnValue(false),
  branchFullyMerged: vi.fn().mockReturnValue(false),
}))

import { runCli } from '../../src/utils/run-cli.js'
import { workingTreeDirty, branchFullyMerged } from '../../src/worktree/validate.js'

const mockRunCli = vi.mocked(runCli)
const mockWorkingTreeDirty = vi.mocked(workingTreeDirty)
const mockBranchFullyMerged = vi.mocked(branchFullyMerged)

function ok(stdout: string) {
  return { stdout, stderr: '', exitCode: 0, durationMs: 1 }
}

const NOW = new Date('2026-07-10T12:00:00.000Z')
const HOURS = 24

describe('detectPruneCandidates (#1873 T5)', () => {
  let gitRoot: string

  function writeOpenLog(
    entries: Array<{ taskId: string; branch: string; openedAt: string; mkdir?: boolean }>,
  ): void {
    mkdirSync(join(gitRoot, '.arbiter'), { recursive: true })
    const full = entries.map((e) => {
      const worktreePath = join(gitRoot, '.worktrees', e.taskId)
      if (e.mkdir !== false) mkdirSync(worktreePath, { recursive: true })
      return {
        taskId: e.taskId,
        slug: null,
        worktreePath,
        branch: e.branch,
        baseBranch: 'main',
        baseRef: 'abc123',
        openedAt: e.openedAt,
      }
    })
    writeFileSync(
      join(gitRoot, '.arbiter', 'worktree-open.log.json'),
      JSON.stringify(full, null, 2),
    )
  }

  beforeEach(() => {
    gitRoot = mkdtempSync(join(tmpdir(), 'arbiter-prune-'))
    vi.clearAllMocks()
    mockWorkingTreeDirty.mockReturnValue(false)
    mockBranchFullyMerged.mockReturnValue(false)
    // default: any `git log -1` returns an old commit date
    mockRunCli.mockReturnValue(ok('2026-07-01T00:00:00.000Z'))
  })

  afterEach(() => {
    rmSync(gitRoot, { recursive: true, force: true })
  })

  async function detect() {
    const { detectPruneCandidates } = await import('../../src/commands/worktree-prune.js')
    return detectPruneCandidates({
      gitRoot,
      staleHours: HOURS,
      noFetch: true,
      now: NOW,
    })
  }

  it('a merged clean worktree is a candidate (reason: merged)', async () => {
    writeOpenLog([{ taskId: '101', branch: 'task/101', openedAt: '2026-07-09T00:00:00.000Z' }])
    mockBranchFullyMerged.mockReturnValue(true)

    const { candidates } = await detect()
    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.reason).toBe('merged')
    expect(candidates[0]!.taskId).toBe('101')
  })

  it('an inactive clean unmerged worktree beyond the threshold is a candidate (reason: inactive)', async () => {
    writeOpenLog([{ taskId: '102', branch: 'task/102', openedAt: '2026-07-01T00:00:00.000Z' }])
    // last commit 2026-07-01 (default mock), openedAt 2026-07-01 → age 9d > 24h

    const { candidates } = await detect()
    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.reason).toBe('inactive')
  })

  it('a DIRTY worktree is NEVER a candidate, even when merged (INV-96)', async () => {
    writeOpenLog([{ taskId: '103', branch: 'task/103', openedAt: '2026-07-01T00:00:00.000Z' }])
    mockWorkingTreeDirty.mockReturnValue(true)
    mockBranchFullyMerged.mockReturnValue(true)

    const { candidates, skipped } = await detect()
    expect(candidates).toHaveLength(0)
    expect(skipped.some((s) => s.taskId === '103' && s.reason === 'dirty')).toBe(true)
  })

  it('a recently-active unmerged worktree is not a candidate', async () => {
    writeOpenLog([{ taskId: '104', branch: 'task/104', openedAt: '2026-07-01T00:00:00.000Z' }])
    // last commit 1h ago → inside the 24h threshold
    mockRunCli.mockReturnValue(ok('2026-07-10T11:00:00.000Z'))

    const { candidates, skipped } = await detect()
    expect(candidates).toHaveLength(0)
    expect(skipped.some((s) => s.taskId === '104' && s.reason === 'active')).toBe(true)
  })

  it('a fresh empty worktree is protected by the openedAt floor', async () => {
    // Branch has no own commits — git log returns the BASE commit date (old).
    // openedAt is 1h ago → activity floor keeps it alive.
    writeOpenLog([{ taskId: '105', branch: 'task/105', openedAt: '2026-07-10T11:00:00.000Z' }])
    mockRunCli.mockReturnValue(ok('2026-06-01T00:00:00.000Z'))

    const { candidates } = await detect()
    expect(candidates).toHaveLength(0)
  })

  it('entries whose worktree dir is gone are skipped (stale log), never candidates', async () => {
    writeOpenLog([
      { taskId: '106', branch: 'task/106', openedAt: '2026-07-01T00:00:00.000Z', mkdir: false },
    ])

    const { candidates, skipped } = await detect()
    expect(candidates).toHaveLength(0)
    expect(skipped.some((s) => s.taskId === '106' && s.reason === 'missing-dir')).toBe(true)
  })

  it('unreadable branch activity (missing ref) is skipped fail-closed, not guessed', async () => {
    writeOpenLog([{ taskId: '107', branch: 'task/107', openedAt: '2026-07-01T00:00:00.000Z' }])
    mockRunCli.mockImplementation(() => {
      throw new Error('unknown revision')
    })

    const { candidates, skipped } = await detect()
    expect(candidates).toHaveLength(0)
    expect(skipped.some((s) => s.taskId === '107' && s.reason === 'branch-missing')).toBe(true)
  })
})

describe('runWorktreePrune (#1873 T5)', () => {
  let gitRoot: string

  beforeEach(() => {
    gitRoot = mkdtempSync(join(tmpdir(), 'arbiter-prune-run-'))
    mkdirSync(join(gitRoot, '.arbiter'), { recursive: true })
    vi.clearAllMocks()
    mockWorkingTreeDirty.mockReturnValue(false)
    mockBranchFullyMerged.mockReturnValue(true)
    // rev-parse → gitRoot; git log → old commit date; anything else → ok('')
    mockRunCli.mockImplementation((_cmd, args) => {
      if (args[0] === 'rev-parse') return ok(gitRoot)
      if (args[0] === 'log') return ok('2026-07-01T00:00:00.000Z')
      return ok('')
    })
  })

  afterEach(() => {
    rmSync(gitRoot, { recursive: true, force: true })
  })

  function seedOne(taskId: string): string {
    const worktreePath = join(gitRoot, '.worktrees', taskId)
    mkdirSync(worktreePath, { recursive: true })
    writeFileSync(
      join(gitRoot, '.arbiter', 'worktree-open.log.json'),
      JSON.stringify([
        {
          taskId,
          slug: null,
          worktreePath,
          branch: `task/${taskId}`,
          baseBranch: 'main',
          baseRef: 'abc',
          openedAt: '2026-07-01T00:00:00.000Z',
        },
      ]),
    )
    return worktreePath
  }

  it('dry-run is the DEFAULT: reports candidates, closes nothing', async () => {
    seedOne('201')
    const lines: string[] = []
    const { runWorktreePrune } = await import('../../src/commands/worktree-prune.js')
    const closeCalls: string[] = []
    runWorktreePrune({
      cwd: gitRoot,
      staleHours: HOURS,
      noFetch: true,
      now: NOW,
      onLine: (l) => lines.push(l),
      closeFn: (opts) => closeCalls.push(opts.taskId),
    })

    expect(closeCalls).toHaveLength(0)
    expect(lines.some((l) => l.includes('201'))).toBe(true)
    expect(lines.some((l) => l.toLowerCase().includes('dry-run'))).toBe(true)
    expect(lines.some((l) => l.includes('--execute'))).toBe(true)
  })

  it('--execute closes merged candidates normally (branch deleted by close path)', async () => {
    seedOne('202')
    const { runWorktreePrune } = await import('../../src/commands/worktree-prune.js')
    const closeCalls: Array<{ taskId: string; force?: boolean; keepBranch?: boolean }> = []
    runWorktreePrune({
      cwd: gitRoot,
      staleHours: HOURS,
      noFetch: true,
      now: NOW,
      execute: true,
      onLine: () => {},
      closeFn: (opts) => closeCalls.push(opts),
    })

    expect(closeCalls).toHaveLength(1)
    expect(closeCalls[0]!.taskId).toBe('202')
    expect(closeCalls[0]!.force ?? false).toBe(false)
    expect(closeCalls[0]!.keepBranch ?? false).toBe(false)
  })

  it('--execute closes inactive-unmerged candidates with keepBranch (work preserved)', async () => {
    seedOne('203')
    mockBranchFullyMerged.mockReturnValue(false) // unmerged → inactive path
    const { runWorktreePrune } = await import('../../src/commands/worktree-prune.js')
    const closeCalls: Array<{ taskId: string; force?: boolean; keepBranch?: boolean }> = []
    runWorktreePrune({
      cwd: gitRoot,
      staleHours: HOURS,
      noFetch: true,
      now: NOW,
      execute: true,
      onLine: () => {},
      closeFn: (opts) => closeCalls.push(opts),
    })

    expect(closeCalls).toHaveLength(1)
    expect(closeCalls[0]!.keepBranch).toBe(true)
    expect(closeCalls[0]!.force).toBe(true) // skip merge check — tree is clean, branch survives
  })
})
