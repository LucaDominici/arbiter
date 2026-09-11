/**
 * Pre-commit hook: formatting is checked on staged files even inside a git
 * worktree, where the L1 gate is skipped (#1695). Without this, a Prettier
 * slip surfaces only at the exact-head L2, minutes later.
 *
 * Behavioural test: a real repository with a real `git worktree add`, the
 * host hook copied in, `node_modules` linked to this checkout so `npx prettier`
 * resolves, and the gitleaks config copied so the staged secret scan still runs.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync, symlinkSync } from 'node:fs'
import { spawnSync, execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const HOOK_SRC = join(REPO_ROOT, '.githooks', 'pre-commit')

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: gitEnv() })
}

function gitEnv() {
  const env = { ...process.env }
  delete env.GIT_DIR
  delete env.GIT_INDEX_FILE
  delete env.GIT_WORK_TREE
  return {
    ...env,
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@t',
  }
}

/** A main repo with one commit plus a worktree that stages `staged.ts` with the given content. */
function worktreeWithStaged(content: string, fileName = 'staged.ts', phase?: string) {
  const root = mkdtempSync(join(tmpdir(), 'arbiter-precommit-'))
  tempDirs.push(root)
  const main = join(root, 'main')
  mkdirSync(main)
  git(main, 'init', '-q', '-b', 'main')
  writeFileSync(join(main, 'README.md'), '# t\n')
  git(main, 'add', 'README.md')
  git(main, 'commit', '-q', '-m', 'init')
  const wt = join(root, 'wt')
  git(main, 'worktree', 'add', '-q', wt, '-b', 'task/wt')
  mkdirSync(join(wt, '.githooks'))
  copyFileSync(HOOK_SRC, join(wt, '.githooks', 'pre-commit'))
  copyFileSync(join(REPO_ROOT, '.gitleaks.toml'), join(wt, '.gitleaks.toml'))
  copyFileSync(join(REPO_ROOT, '.prettierrc.json'), join(wt, '.prettierrc.json'))
  mkdirSync(join(wt, 'suppressions'))
  writeFileSync(join(wt, 'suppressions', '.gitleaksignore'), '')
  symlinkSync(join(REPO_ROOT, 'node_modules'), join(wt, 'node_modules'))
  writeFileSync(join(wt, fileName), content)
  git(wt, 'add', fileName)
  if (phase) {
    mkdirSync(join(wt, '.claude', '.task'), { recursive: true })
    writeFileSync(join(wt, '.claude', '.task', 'status.json'), JSON.stringify({ phase }))
  }
  return wt
}

function runHook(wt: string) {
  return spawnSync('bash', [join(wt, '.githooks', 'pre-commit')], {
    cwd: wt,
    encoding: 'utf8',
    env: gitEnv(),
  })
}

describe('.githooks/pre-commit in a git worktree', () => {
  it('rejects a staged file that Prettier would reformat', () => {
    const wt = worktreeWithStaged('const  x   =  1\n')
    const result = runHook(wt)
    expect(result.status, result.stdout + result.stderr).toBe(1)
    expect(result.stdout + result.stderr).toMatch(/prettier/i)
  })

  it('keeps a path with spaces whole (formatted passes, unformatted fails)', () => {
    const ok = runHook(worktreeWithStaged('const x = 1\n', 'with space.ts'))
    expect(ok.status, ok.stdout + ok.stderr).toBe(0)
    const bad = runHook(worktreeWithStaged('const  x   =  1\n', 'with space.ts'))
    expect(bad.status, bad.stdout + bad.stderr).toBe(1)
  })

  it('also checks a RED test-only commit (#2051 bypass runs after the format check)', () => {
    const result = runHook(worktreeWithStaged('const  x   =  1\n', 'red.test.ts', 'red'))
    expect(result.status, result.stdout + result.stderr).toBe(1)
    expect(result.stdout + result.stderr).toMatch(/prettier/i)
  })

  it('still skips the L1 gate when the staged file is formatted', () => {
    const wt = worktreeWithStaged('const x = 1\n')
    const result = runHook(wt)
    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(result.stdout).toMatch(/git worktree detected/)
  })
})
