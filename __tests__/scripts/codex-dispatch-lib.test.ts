import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCodexArgs, buildCodexReviewArgs } from '../../scripts/lib/codex-dispatch-lib.mjs'

const LIB_PATH = join(__dirname, '../../scripts/lib/codex-dispatch-lib.mjs')

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

  it('stays a pure argv builder (CANON-25 proof for its fail-closed-audit exemption)', () => {
    // codex-dispatch-lib.mjs is exempted from the fail-closed try/catch contract on the
    // claim that it does no I/O at all — the caller (codex-dispatch.mjs, which owns the
    // try/catch) resolves every path and reads the brief before calling in. Fail this test
    // if the lib starts importing an I/O-capable module again (the string-blocklist this
    // test used before #2770 didn't catch execFileSync/readFileSync — forbid the imports
    // themselves instead, which can't be dodged by renaming a call).
    const source = readFileSync(LIB_PATH, 'utf8')
    for (const forbiddenImport of ['node:fs', 'node:child_process']) {
      expect(source).not.toContain(forbiddenImport)
    }
    for (const forbidden of [
      'spawn',
      'exec(',
      'execFileSync',
      'fork',
      'readFileSync',
      'writeFileSync',
      'mkdirSync',
      'unlinkSync',
    ]) {
      expect(source).not.toContain(forbidden)
    }
  })
})
