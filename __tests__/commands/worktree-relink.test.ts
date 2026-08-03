import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, lstatSync, readlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const harness = vi.hoisted(() => ({ removeSourceAfterMaterialize: false }))

vi.mock('../../src/utils/run-cli.js', () => ({
  runCli: vi.fn(),
  CliError: class CliError extends Error {},
}))

vi.mock('../../src/worktree/validate.js', () => ({
  isRunningFromMainRepo: vi.fn().mockReturnValue(true),
  workingTreeDirty: vi.fn().mockReturnValue(false),
  branchFullyMerged: vi.fn().mockReturnValue(true),
}))

vi.mock('../../src/utils/config.js', () => ({
  loadConfig: vi.fn().mockReturnValue(null),
}))

vi.mock('../../src/worktree/links.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/worktree/links.js')>()
  const fs = await import('node:fs')
  const path = await import('node:path')
  return {
    ...actual,
    materializeLink: vi.fn((...args: Parameters<typeof actual.materializeLink>) => {
      const result = actual.materializeLink(...args)
      if (harness.removeSourceAfterMaterialize && args[0].path === 'node_modules') {
        fs.rmSync(path.join(args[1], 'node_modules', 'pkg-a'), { recursive: true, force: true })
      }
      return result
    }),
  }
})

import { runCli } from '../../src/utils/run-cli.js'
import { loadConfig } from '../../src/utils/config.js'
import { runWorktreeOpen, runWorktreeRelink } from '../../src/commands/worktree.js'

const mockRunCli = vi.mocked(runCli)
const mockLoadConfig = vi.mocked(loadConfig)

function ok(stdout: string) {
  return { stdout, stderr: '', exitCode: 0, durationMs: 1 }
}

describe('worktree link integrity recovery (#2206)', () => {
  let gitRoot: string
  let worktreesDir: string

  beforeEach(() => {
    gitRoot = mkdtempSync(join(tmpdir(), 'arbiter-wt-relink-main-'))
    worktreesDir = mkdtempSync(join(tmpdir(), 'arbiter-wt-relink-wts-'))
    mkdirSync(join(gitRoot, '.arbiter'), { recursive: true })
    mkdirSync(join(gitRoot, 'node_modules', 'pkg-a'), { recursive: true })
    writeFileSync(join(gitRoot, 'node_modules', 'pkg-a', 'index.js'), 'module.exports = {}')
    harness.removeSourceAfterMaterialize = false
    mockRunCli.mockReset()
    mockLoadConfig.mockReset()
    mockLoadConfig.mockReturnValue(null)
    mockRunCli.mockImplementation((command, args) => {
      if (command === 'git' && args[0] === 'rev-parse' && args.includes('--show-toplevel')) {
        return ok(gitRoot)
      }
      if (command === 'git' && args[0] === 'worktree' && args[1] === 'add') {
        mkdirSync(String(args[4]), { recursive: true })
      }
      return ok('main')
    })
  })

  afterEach(() => {
    rmSync(gitRoot, { recursive: true, force: true })
    rmSync(worktreesDir, { recursive: true, force: true })
  })

  it('warns during open when a materialized link becomes dangling (AC-2206.2)', async () => {
    harness.removeSourceAfterMaterialize = true
    const warnings: string[] = []

    await runWorktreeOpen({
      taskId: '2206',
      cwd: gitRoot,
      worktreesDir,
      onWarning: (warning) => warnings.push(warning),
    })

    expect(warnings).toEqual([expect.stringContaining('dangling symlink: node_modules/pkg-a')])
  })

  it('recreates a missing child link in an existing worktree (AC-2206.3)', () => {
    const worktreePath = mkdtempSync(join(worktreesDir, 'arbiter-wt-relink-existing-'))
    writeFileSync(
      join(gitRoot, '.arbiter', 'worktree-open.log.json'),
      JSON.stringify([
        {
          taskId: '#2206',
          slug: null,
          worktreePath,
          branch: 'task/#2206-relink',
          baseBranch: 'main',
          baseRef: 'main',
          openedAt: new Date().toISOString(),
        },
      ]) + '\n',
    )

    runWorktreeRelink({ taskId: '2206', cwd: gitRoot })

    const childLink = join(worktreePath, 'node_modules', 'pkg-a')
    expect(lstatSync(childLink).isSymbolicLink()).toBe(true)
    expect(readlinkSync(childLink)).toBe(resolve(gitRoot, 'node_modules', 'pkg-a'))
  })

  it('relinks a missing buildLinks child when requested', () => {
    const worktreePath = mkdtempSync(join(worktreesDir, 'arbiter-wt-relink-build-'))
    mkdirSync(join(gitRoot, 'dist', 'pkg-a'), { recursive: true })
    mkdirSync(join(worktreePath, 'dist'), { recursive: true })
    writeFileSync(
      join(gitRoot, '.arbiter', 'worktree-open.log.json'),
      JSON.stringify([
        {
          taskId: '#2206',
          slug: null,
          worktreePath,
          branch: 'task/#2206-relink',
          baseBranch: 'main',
          baseRef: 'main',
          openedAt: new Date().toISOString(),
        },
      ]) + '\n',
    )
    mockLoadConfig.mockReturnValue({
      worktree: {
        base: null,
        links: [],
        buildLinks: [{ path: 'dist', required: false, type: 'directory', strategy: 'symlink-children' }],
        closeHook: null,
      },
    } as ReturnType<typeof loadConfig>)

    runWorktreeRelink({ taskId: '2206', cwd: gitRoot, withBuildLinks: true })

    const childLink = join(worktreePath, 'dist', 'pkg-a')
    expect(lstatSync(childLink).isSymbolicLink()).toBe(true)
    expect(readlinkSync(childLink)).toBe(resolve(gitRoot, 'dist', 'pkg-a'))
  })
})
