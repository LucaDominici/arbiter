import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCodexArgs, buildCodexReviewArgs } from '../../scripts/lib/codex-dispatch-lib.mjs'

function makeWorktree() {
  const hub = mkdtempSync(join(tmpdir(), 'codex-dispatch-'))
  const worktree = join(hub, 'writer')
  const brief = join(hub, 'brief.txt')
  const out = join(hub, 'out.txt')
  execFileSync('git', ['init'], { cwd: hub })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: hub })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: hub })
  writeFileSync(join(hub, 'README.md'), 'fixture\n')
  execFileSync('git', ['add', 'README.md'], { cwd: hub })
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: hub })
  execFileSync('git', ['worktree', 'add', '-b', 'writer', worktree], { cwd: hub })
  mkdirSync(join(worktree, 'node_modules', '.vite-temp'), { recursive: true })
  writeFileSync(brief, 'reply with ok')
  return { hub, worktree, brief, out, cleanup: () => rmSync(hub, { recursive: true, force: true }) }
}

function addDirs(args: string[]) {
  return args.flatMap((value, index) => (value === '--add-dir' ? [args[index + 1]] : []))
}

describe('codex dispatch argument builder', () => {
  it('builds a fresh writer command with its real Git and Vite paths', () => {
    const fixture = makeWorktree()
    try {
      const args = buildCodexArgs({
        worktreePath: fixture.worktree,
        model: 'gpt-5.6-terra',
        effort: 'low',
        briefPath: fixture.brief,
        outPath: fixture.out,
      })
      const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], {
        cwd: fixture.worktree,
        encoding: 'utf8',
      }).trim()
      const commonDir = execFileSync(
        'git',
        ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        {
          cwd: fixture.worktree,
          encoding: 'utf8',
        },
      ).trim()

      expect(args).toContain('approval_policy=never')
      expect(args).toContain('-s')
      expect(args[args.indexOf('-s') + 1]).toBe('workspace-write')
      expect(addDirs(args)).toEqual([
        gitDir,
        commonDir,
        join(fixture.worktree, 'node_modules', '.vite-temp'),
      ])
      expect(args.at(-1)).toBe('reply with ok')
    } finally {
      fixture.cleanup()
    }
  })

  it('omits fresh sandbox plumbing when resuming', () => {
    const fixture = makeWorktree()
    try {
      const args = buildCodexArgs({
        worktreePath: fixture.worktree,
        model: 'gpt-5.6-terra',
        effort: 'low',
        briefPath: fixture.brief,
        outPath: fixture.out,
        resumeSessionId: 'session-123',
      })

      expect(args.slice(0, 3)).toEqual(['exec', 'resume', 'session-123'])
      expect(args).not.toContain('-s')
      expect(args).not.toContain('--add-dir')
    } finally {
      fixture.cleanup()
    }
  })

  it('builds read-only reviewer commands without writer directories', () => {
    const args = buildCodexReviewArgs({
      model: 'gpt-5.6-terra',
      effort: 'low',
      outPath: '/tmp/review.txt',
    })

    expect(args).toContain('-s')
    expect(args[args.indexOf('-s') + 1]).toBe('read-only')
    expect(args).not.toContain('--add-dir')
    expect(args).toContain('approval_policy=never')
  })
})
