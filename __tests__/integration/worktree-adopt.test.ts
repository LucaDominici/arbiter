import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runWorktreeAdopt, runWorktreeClose } from '../../src/commands/worktree.js'
import { runTaskInit, runTaskReviewRound } from '../../src/commands/task.js'
import { readUnifiedState, writeUnifiedState } from '../../src/commands/task-state.js'

let repo: string
let checkout: string
let secondCheckout: string
const CLI_PATH = resolve(new URL('../../src/cli.ts', import.meta.url).pathname)
const TSX_ESM_LOADER = createRequire(import.meta.url).resolve('tsx/esm')

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim()
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'arbiter-adopt-main-'))
  checkout = mkdtempSync(join(tmpdir(), 'native-checkout-'))
  rmSync(checkout, { recursive: true, force: true })
  secondCheckout = mkdtempSync(join(tmpdir(), 'native-checkout-'))
  rmSync(secondCheckout, { recursive: true, force: true })
  git(repo, 'init', '-b', 'main')
  git(repo, 'config', 'user.email', 'test@arbiter.dev')
  git(repo, 'config', 'user.name', 'Arbiter Test')
  writeFileSync(join(repo, 'README.md'), '# fixture\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'init')
})

afterEach(() => {
  try {
    git(repo, 'worktree', 'remove', '--force', checkout)
    git(repo, 'worktree', 'remove', '--force', secondCheckout)
    git(repo, 'worktree', 'prune')
  } catch {
    // fixture may already be gone
  }
  rmSync(repo, { recursive: true, force: true })
  rmSync(checkout, { recursive: true, force: true })
  rmSync(secondCheckout, { recursive: true, force: true })
})

describe('runWorktreeAdopt', () => {
  it('adopts a manual native worktree and applies the existing cache-isolated link policy', async () => {
    mkdirSync(join(repo, 'node_modules', 'pkg-a'), { recursive: true })
    mkdirSync(join(repo, 'node_modules', '.vite'), { recursive: true })
    git(repo, 'worktree', 'add', '-b', 'feature/native', checkout)

    await runWorktreeAdopt({ taskId: '#2564', cwd: checkout })

    const log = JSON.parse(
      readFileSync(join(repo, '.arbiter', 'worktree-open.log.json'), 'utf-8'),
    ) as Array<Record<string, unknown>>
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({
      taskId: '#2564',
      worktreePath: resolve(checkout),
      branch: 'feature/native',
      owner: 'host',
    })
    const packageLink = join(checkout, 'node_modules', 'pkg-a')
    expect(lstatSync(packageLink).isSymbolicLink()).toBe(true)
    expect(readlinkSync(packageLink)).toBe(resolve(repo, 'node_modules', 'pkg-a'))
    expect(existsSync(join(checkout, 'node_modules', '.vite'))).toBe(false)

    await runWorktreeAdopt({ taskId: '#2564', worktreePath: checkout, cwd: repo })
    const repeated = JSON.parse(
      readFileSync(join(repo, '.arbiter', 'worktree-open.log.json'), 'utf-8'),
    ) as unknown[]
    expect(repeated).toHaveLength(1)
    expect(() => runWorktreeClose({ taskId: '#2564', cwd: repo, force: true })).toThrow(
      /host-owned/i,
    )
  })

  it("links dependencies from the target checkout's nested package roots", async () => {
    mkdirSync(join(repo, 'frontend'), { recursive: true })
    writeFileSync(join(repo, 'frontend', 'package.json'), '{"name":"frontend"}\n')
    git(repo, 'add', 'frontend/package.json')
    git(repo, 'commit', '-m', 'add nested package fixture')
    mkdirSync(join(repo, 'node_modules', 'root-pkg'), { recursive: true })
    writeFileSync(join(repo, 'node_modules', 'root-pkg', 'index.js'), 'module.exports = {}\n')
    mkdirSync(join(repo, 'frontend', 'node_modules', 'frontend-pkg'), { recursive: true })
    writeFileSync(
      join(repo, 'frontend', 'node_modules', 'frontend-pkg', 'index.js'),
      'module.exports = {}\n',
    )
    mkdirSync(join(repo, 'frontend', 'node_modules', '.vite'), { recursive: true })
    git(repo, 'worktree', 'add', '-b', 'feature/target-dependencies', checkout)
    symlinkSync(join(repo, 'frontend'), join(repo, 'aliased-package'), 'dir')
    mkdirSync(join(checkout, 'aliased-package'))

    await runWorktreeAdopt({ taskId: '#2799', worktreePath: checkout, cwd: repo })

    expect(readlinkSync(join(checkout, 'node_modules', 'root-pkg'))).toBe(
      resolve(repo, 'node_modules', 'root-pkg'),
    )
    expect(readlinkSync(join(checkout, 'frontend', 'node_modules', 'frontend-pkg'))).toBe(
      resolve(repo, 'frontend', 'node_modules', 'frontend-pkg'),
    )
    expect(existsSync(join(checkout, 'frontend', 'node_modules', '.vite'))).toBe(false)
    expect(existsSync(join(checkout, 'aliased-package', 'node_modules'))).toBe(false)
  })

  it('turns a detached Codex checkout into the deterministic task branch', async () => {
    git(repo, 'worktree', 'add', '--detach', checkout, 'HEAD')

    await runWorktreeAdopt({ taskId: '#2564', worktreePath: checkout, cwd: repo })

    expect(git(checkout, 'branch', '--show-current')).toBe('task/#2564')
  })

  it('applies configured local-library and opt-in build links during adoption', async () => {
    git(repo, 'worktree', 'add', '-b', 'feature/resources', checkout)
    mkdirSync(join(repo, 'vendor', 'local-lib'), { recursive: true })
    mkdirSync(join(repo, 'dist'), { recursive: true })
    writeFileSync(join(repo, 'vendor', 'local-lib', 'index.js'), 'export {}\n')
    writeFileSync(join(repo, 'dist', 'bundle.js'), 'export {}\n')
    const config = JSON.parse(readFileSync(resolve('arbiter.json'), 'utf-8')) as Record<
      string,
      unknown
    >
    writeFileSync(
      join(repo, 'arbiter.json'),
      JSON.stringify({
        ...config,
        projectName: 'fixture',
        worktree: {
          base: null,
          links: [{ path: 'vendor/local-lib', required: true, type: 'directory' }],
          buildLinks: [{ path: 'dist', required: true, type: 'directory' }],
        },
      }),
    )

    await runWorktreeAdopt({ taskId: '#2564', worktreePath: checkout, cwd: repo })
    expect(realpathSync(join(checkout, 'vendor', 'local-lib'))).toBe(
      realpathSync(join(repo, 'vendor', 'local-lib')),
    )
    expect(existsSync(join(checkout, 'dist'))).toBe(false)

    await runWorktreeAdopt({
      taskId: '#2564',
      worktreePath: checkout,
      cwd: repo,
      withBuildLinks: true,
    })

    expect(realpathSync(join(checkout, 'dist'))).toBe(realpathSync(join(repo, 'dist')))
  })

  it('exposes adoption through the public CLI', () => {
    git(repo, 'worktree', 'add', '-b', 'feature/cli-adopt', checkout)

    const result = spawnSync(
      process.execPath,
      ['--import', TSX_ESM_LOADER, CLI_PATH, 'worktree', 'prepare', '#2564', checkout, '--json'],
      { cwd: repo, encoding: 'utf-8', timeout: 15_000 },
    )

    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ command: 'worktree prepare', status: 'ok' })
  })

  it('adopts a Claude-native checkout before binding its optional session attestation', async () => {
    const home = mkdtempSync(join(tmpdir(), 'arbiter-claude-home-'))
    try {
      git(repo, 'worktree', 'add', '-b', 'feature/claude-native', checkout)
      await runWorktreeAdopt({ taskId: '#2564', worktreePath: checkout, cwd: repo })
      const sessionId = 'claude-native-session'
      const project = resolve(checkout).replace(/[^A-Za-z0-9]/g, '-')
      const transcriptDir = join(home, '.claude', 'projects', project)
      mkdirSync(transcriptDir, { recursive: true })
      writeFileSync(join(transcriptDir, `${sessionId}.jsonl`), '{}\n')

      runTaskInit({
        id: '#2564',
        worktree: checkout,
        dir: checkout,
        host: {
          cwd: checkout,
          homeDir: home,
          env: { CLAUDE_CODE_SESSION_ID: sessionId, CLAUDE_PROJECT_DIR: checkout },
        },
      })

      expect(readUnifiedState(checkout)?.hostBinding?.sessionId).toBe(sessionId)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('replaces the task binding on handoff instead of leaving two authoritative checkouts', async () => {
    git(repo, 'worktree', 'add', '-b', 'feature/first-host', checkout)
    git(repo, 'worktree', 'add', '-b', 'feature/second-host', secondCheckout)
    await runWorktreeAdopt({ taskId: '#2564', worktreePath: checkout, cwd: repo })
    runTaskInit({
      id: '#2564',
      worktree: checkout,
      dir: checkout,
      host: { cwd: checkout, env: {} },
    })
    writeUnifiedState(checkout, {
      phase: 'refactor',
      review: { rounds: 1, lastReviewedSha: git(checkout, 'rev-parse', 'HEAD') },
    })
    const receipts = [
      join(checkout, '.arbiter', 'gate-pass.json'),
      join(checkout, '.arbiter', 'agents-dispatched.json'),
      join(checkout, '.arbiter', 'evidence', 'ac-fit', '2564.json'),
      join(checkout, '.arbiter', 'evidence', 'agent-returns', '_2564', 'reviewer-0.json'),
    ]
    for (const receipt of receipts) {
      mkdirSync(join(receipt, '..'), { recursive: true })
      writeFileSync(receipt, '{}\n')
    }

    await runWorktreeAdopt({ taskId: '#2564', worktreePath: secondCheckout, cwd: repo })

    const log = JSON.parse(
      readFileSync(join(repo, '.arbiter', 'worktree-open.log.json'), 'utf-8'),
    ) as Array<Record<string, unknown>>
    expect(log).toHaveLength(1)
    expect(log[0]?.['worktreePath']).toBe(resolve(secondCheckout))

    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(checkout)
    expect(() => runTaskReviewRound({ dir: checkout })).toThrow(
      /binding.*(?:stale|missing|ambiguous)/i,
    )
    cwd.mockRestore()
    expect(() =>
      runTaskInit({ id: '#2564', dir: checkout, host: { cwd: checkout, env: {} } }),
    ).toThrow(/binding.*(?:stale|missing|ambiguous)/i)
    for (const receipt of receipts) expect(existsSync(receipt)).toBe(false)
  })

  it('invalidates task state when the checkout is adopted again', async () => {
    git(repo, 'worktree', 'add', '-b', 'feature/native', checkout)
    await runWorktreeAdopt({ taskId: '#2564', worktreePath: checkout, cwd: repo })
    runTaskInit({
      id: '#2564',
      worktree: checkout,
      dir: checkout,
      host: { cwd: checkout, env: {} },
    })
    const firstBinding = readUnifiedState(checkout)?.hostBinding?.bindingId
    writeUnifiedState(checkout, {
      phase: 'refactor',
      review: { rounds: 1, lastReviewedSha: git(checkout, 'rev-parse', 'HEAD') },
    })
    const receiptPaths = [
      join(checkout, '.arbiter', 'gate-pass.json'),
      join(checkout, '.arbiter', 'agents-dispatched.json'),
      join(checkout, '.arbiter', 'evidence', 'ac-fit', '2564.json'),
      join(checkout, '.arbiter', 'evidence', 'agent-returns', '_2564', 'reviewer-0.json'),
    ]
    for (const path of receiptPaths) {
      mkdirSync(join(path, '..'), { recursive: true })
      writeFileSync(path, '{}\n')
    }

    await runWorktreeAdopt({ taskId: '#2564', worktreePath: checkout, cwd: repo })

    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(checkout)
    expect(() => runTaskReviewRound({ dir: checkout })).toThrow(/binding is stale/i)
    cwd.mockRestore()
    expect(() =>
      runTaskInit({ id: '#2564', dir: checkout, host: { cwd: checkout, env: {} } }),
    ).toThrow(/binding is stale/i)
    runTaskInit({
      id: '#2564',
      worktree: checkout,
      dir: checkout,
      host: { cwd: checkout, env: {} },
    })
    const rebound = readUnifiedState(checkout)
    expect(rebound?.hostBinding?.bindingId).not.toBe(firstBinding)
    expect(rebound?.phase).toBe('preflight')
    expect(rebound?.review).toBeUndefined()
    for (const path of receiptPaths) expect(existsSync(path)).toBe(false)
  })

  it('does not close a replacement checkout reusing the same path and branch', () => {
    git(repo, 'worktree', 'add', '-b', 'feature/replaced', checkout)
    mkdirSync(join(repo, '.arbiter'), { recursive: true })
    mkdirSync(join(checkout, '.arbiter'), { recursive: true })
    writeFileSync(
      join(checkout, '.arbiter', 'checkout-binding.json'),
      JSON.stringify({ taskId: '#2564', bindingId: 'original-binding', owner: 'arbiter' }),
    )
    writeFileSync(
      join(repo, '.arbiter', 'worktree-open.log.json'),
      JSON.stringify([
        {
          taskId: '#2564',
          slug: null,
          worktreePath: resolve(checkout),
          branch: 'feature/replaced',
          baseBranch: 'main',
          baseRef: git(repo, 'rev-parse', '--short', 'HEAD'),
          openedAt: new Date().toISOString(),
          bindingId: 'original-binding',
          owner: 'arbiter',
        },
      ]),
    )
    git(repo, 'worktree', 'remove', '--force', checkout)
    git(repo, 'worktree', 'add', checkout, 'feature/replaced')

    expect(() =>
      runWorktreeClose({ taskId: '#2564', cwd: repo, force: true, keepBranch: true }),
    ).toThrow(/no longer matches Git worktree inventory/i)
    expect(existsSync(checkout)).toBe(true)
  })

  it('rejects a directory that Git does not inventory as a linked worktree', async () => {
    mkdirSync(checkout, { recursive: true })
    await expect(
      runWorktreeAdopt({ taskId: '#2564', worktreePath: checkout, cwd: repo }),
    ).rejects.toThrow(/git worktree inventory/i)
  })

  it('rejects adoption of the primary checkout', async () => {
    await expect(
      runWorktreeAdopt({ taskId: '#2564', worktreePath: repo, cwd: repo }),
    ).rejects.toThrow(/not a linked checkout/i)
  })
})
