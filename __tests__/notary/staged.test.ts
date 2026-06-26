import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { getStagedCommitMessage } from '../../src/notary/staged.js'

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim()
}

// One shared main repo + one linked worktree, built once. The git operations
// (init/commit/worktree add) are the expensive part, so they live in beforeAll
// rather than a per-test beforeEach to keep this file's parallel footprint small.
describe('getStagedCommitMessage', () => {
  let main: string
  let worktree: string
  let plain: string

  beforeAll(() => {
    main = mkdtempSync(join(tmpdir(), 'arbiter-notary-main-'))
    execFileSync('git', ['init'], { cwd: main, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 'test@arbiter.dev'], {
      cwd: main,
      stdio: 'ignore',
    })
    execFileSync('git', ['config', 'user.name', 'Arbiter Test'], { cwd: main, stdio: 'ignore' })
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: main, stdio: 'ignore' })

    worktree = mkdtempSync(join(tmpdir(), 'arbiter-notary-wt-'))
    rmSync(worktree, { recursive: true, force: true })
    execFileSync('git', ['worktree', 'add', '--detach', worktree, 'HEAD'], {
      cwd: main,
      stdio: 'ignore',
    })

    plain = mkdtempSync(join(tmpdir(), 'arbiter-notary-plain-'))
  })

  afterAll(() => {
    rmSync(main, { recursive: true, force: true })
    rmSync(worktree, { recursive: true, force: true })
    rmSync(plain, { recursive: true, force: true })
  })

  it('reads COMMIT_EDITMSG in a primary checkout', () => {
    const msgPath = git(main, ['rev-parse', '--git-path', 'COMMIT_EDITMSG'])
    writeFileSync(resolve(main, msgPath), 'feat: primary checkout message\n')
    expect(getStagedCommitMessage(main)).toContain('primary checkout message')
  })

  // Regression for #1561: in a worktree, `.git` is a gitdir-pointer FILE, not a
  // directory, so the old hand-joined `<cwd>/.git/COMMIT_EDITMSG` never resolved
  // and the function always returned '' — false-failing `arbiter notary check`.
  // The real COMMIT_EDITMSG lives under <main>/.git/worktrees/<name>/.
  it('reads COMMIT_EDITMSG in a git worktree (#1561)', () => {
    const realMsgPath = git(worktree, ['rev-parse', '--git-path', 'COMMIT_EDITMSG'])
    writeFileSync(resolve(worktree, realMsgPath), 'docs: worktree commit message\n')
    expect(getStagedCommitMessage(worktree)).toContain('worktree commit message')
  })

  it('returns empty string in a non-git directory', () => {
    expect(getStagedCommitMessage(plain)).toBe('')
  })
})
