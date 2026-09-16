import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runWorktreeAdopt, runWorktreeClose } from '../../src/commands/worktree.js'
import { runTaskInit } from '../../src/commands/task.js'
import { readUnifiedState } from '../../src/commands/task-state.js'

let repo: string
let checkout: string
let secondCheckout: string

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

  it('turns a detached Codex checkout into the deterministic task branch', async () => {
    git(repo, 'worktree', 'add', '--detach', checkout, 'HEAD')

    await runWorktreeAdopt({ taskId: '#2564', worktreePath: checkout, cwd: repo })

    expect(git(checkout, 'branch', '--show-current')).toBe('task/#2564')
  })

  it('replaces the task binding on handoff instead of leaving two authoritative checkouts', async () => {
    git(repo, 'worktree', 'add', '-b', 'feature/first-host', checkout)
    git(repo, 'worktree', 'add', '-b', 'feature/second-host', secondCheckout)
    await runWorktreeAdopt({ taskId: '#2564', worktreePath: checkout, cwd: repo })
    await runWorktreeAdopt({ taskId: '#2564', worktreePath: secondCheckout, cwd: repo })

    const log = JSON.parse(
      readFileSync(join(repo, '.arbiter', 'worktree-open.log.json'), 'utf-8'),
    ) as Array<Record<string, unknown>>
    expect(log).toHaveLength(1)
    expect(log[0]?.['worktreePath']).toBe(resolve(secondCheckout))
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

    await runWorktreeAdopt({ taskId: '#2564', worktreePath: checkout, cwd: repo })

    expect(() =>
      runTaskInit({ id: '#2564', dir: checkout, host: { cwd: checkout, env: {} } }),
    ).toThrow(/binding is stale/i)
    runTaskInit({
      id: '#2564',
      worktree: checkout,
      dir: checkout,
      host: { cwd: checkout, env: {} },
    })
    expect(readUnifiedState(checkout)?.hostBinding?.bindingId).not.toBe(firstBinding)
  })

  it('rejects a directory that Git does not inventory as a linked worktree', async () => {
    mkdirSync(checkout, { recursive: true })
    await expect(
      runWorktreeAdopt({ taskId: '#2564', worktreePath: checkout, cwd: repo }),
    ).rejects.toThrow(/git worktree inventory/i)
  })
})
