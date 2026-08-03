import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import { renderTemplate } from '../../../src/utils/render.js'
import { makeConfig, writeTaskStateFile } from '../../helpers.js'

// #A11 — CLOSER mode enforcement (PreToolUse:Bash). Spawns the rendered hook against a
// real git repo and asserts it blocks (exit 2) the mechanically-checkable subset of the
// 7 rules in `.claude/rules/95-closer-mode.md` ONLY while the task is in its `close`
// phase — and is a no-op (exit 0) on every other phase, proving the phase-scoping itself
// (not just the pattern matching) is load-bearing.

function configFor() {
  return makeConfig('/tmp/test', {
    language: 'typescript',
    governanceLevel: 'L2',
  })
}

function materializeHook(dir: string): void {
  const hooksDir = join(dir, '.claude', 'hooks')
  mkdirSync(hooksDir, { recursive: true })
  writeFileSync(join(hooksDir, 'lib.mjs'), renderTemplate('claude/hooks/lib.mjs.ejs', configFor()))
  writeFileSync(
    join(hooksDir, 'closer-mode-guard.mjs'),
    renderTemplate('claude/hooks/closer-mode-guard.mjs.ejs', configFor()),
  )
}

function setupGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-closer-mode-'))
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' })
  materializeHook(dir)
  return dir
}

function runHook(dir: string, command: string): ReturnType<typeof spawnSync> {
  return spawnSync('node', [join(dir, '.claude', 'hooks', 'closer-mode-guard.mjs')], {
    env: { ...process.env, CLAUDE_TOOL_INPUT_COMMAND: command },
    cwd: dir,
    encoding: 'utf-8',
  })
}

const dirs: string[] = []
function track(dir: string): string {
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('closer-mode-guard hook', () => {
  it('exits 2 for `gh issue create` while in the close phase (Rule 2: no discovery)', () => {
    const dir = track(setupGitRepo())
    writeTaskStateFile(dir, { phase: 'close' })
    const result = runHook(dir, 'gh issue create --title "found a thing"')
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Rule 2')
    expect(result.stderr).toContain('discovery')
  })

  it('exits 2 for `git clean -f` while in the close phase (Rule 2: no gate-appeasement deletions)', () => {
    const dir = track(setupGitRepo())
    writeTaskStateFile(dir, { phase: 'close' })
    const result = runHook(dir, 'git clean -fd')
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('git clean -f')
  })

  it('exits 2 for `git checkout -b` while in the close phase (Rule 1: single named target)', () => {
    const dir = track(setupGitRepo())
    writeTaskStateFile(dir, { phase: 'close' })
    const result = runHook(dir, 'git checkout -b some-other-branch')
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Rule 1')
  })

  it('exits 2 for branch switches while in the close phase (Rule 1: single named target)', () => {
    const branchSwitchCommands = [
      'git checkout main',
      'git switch main',
      'git checkout task/#9-other-thing',
      'git checkout -',
      'git switch -',
    ]

    for (const command of branchSwitchCommands) {
      const dir = track(setupGitRepo())
      writeTaskStateFile(dir, { phase: 'close' })
      const result = runHook(dir, command)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('Rule 1')
    }
  })

  it('exits 0 for path restores while in the close phase (Rule 1 permits routine conflict resolution)', () => {
    const pathRestoreCommands = [
      'git checkout -- src/foo.ts',
      'git checkout .',
      'git checkout HEAD -- src/foo.ts',
      'git checkout --ours src/foo.ts',
      'git checkout --theirs src/foo.ts',
      'git checkout -p src/foo.ts',
      'git restore src/foo.ts',
    ]

    for (const command of pathRestoreCommands) {
      const dir = track(setupGitRepo())
      writeTaskStateFile(dir, { phase: 'close' })
      const result = runHook(dir, command)
      expect(result.status).toBe(0)
    }
  })

  it('exits 0 for `git checkout main` outside the close phase (Rule 1 branch-switch block is phase-scoped)', () => {
    const dir = track(setupGitRepo())
    writeTaskStateFile(dir, { phase: 'green' })
    const result = runHook(dir, 'git checkout main')
    expect(result.status).toBe(0)
  })

  it('exits 2 for `rm` on an untracked file while in the close phase (Rule 2)', () => {
    const dir = track(setupGitRepo())
    writeTaskStateFile(dir, { phase: 'close' })
    writeFileSync(join(dir, 'HANDOFF-SOMETHING.md'), '# a colleague deliverable\n')
    const result = runHook(dir, 'rm HANDOFF-SOMETHING.md')
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('untracked')
  })

  it('exits 0 for `rm` on a tracked file while in the close phase (part of the diff, unaffected)', () => {
    const dir = track(setupGitRepo())
    writeFileSync(join(dir, 'tracked.txt'), 'tracked\n')
    execFileSync('git', ['add', '-A'], { cwd: dir })
    execFileSync('git', ['commit', '-m', 'add tracked file'], { cwd: dir, stdio: 'ignore' })
    writeTaskStateFile(dir, { phase: 'close' })
    const result = runHook(dir, 'rm tracked.txt')
    expect(result.status).toBe(0)
  })

  it('exits 0 for a benign command while in the close phase', () => {
    const dir = track(setupGitRepo())
    writeTaskStateFile(dir, { phase: 'close' })
    const result = runHook(dir, 'git status')
    expect(result.status).toBe(0)
  })

  it('exits 0 for `gh issue create` outside the close phase (proves phase-scoping)', () => {
    const dir = track(setupGitRepo())
    writeTaskStateFile(dir, { phase: 'green' })
    const result = runHook(dir, 'gh issue create --title "found a thing"')
    expect(result.status).toBe(0)
  })

  it('exits 0 for `git clean -f` outside the close phase (proves phase-scoping)', () => {
    const dir = track(setupGitRepo())
    writeTaskStateFile(dir, { phase: 'verification' })
    const result = runHook(dir, 'git clean -fd')
    expect(result.status).toBe(0)
  })

  it('exits 0 for `git checkout -b` outside the close phase (proves phase-scoping)', () => {
    const dir = track(setupGitRepo())
    writeTaskStateFile(dir, { phase: 'red' })
    const result = runHook(dir, 'git checkout -b some-other-branch')
    expect(result.status).toBe(0)
  })

  it('exits 0 for `rm` on an untracked file outside the close phase (proves phase-scoping)', () => {
    const dir = track(setupGitRepo())
    writeTaskStateFile(dir, { phase: 'refactor' })
    writeFileSync(join(dir, 'HANDOFF-SOMETHING.md'), '# a colleague deliverable\n')
    const result = runHook(dir, 'rm HANDOFF-SOMETHING.md')
    expect(result.status).toBe(0)
  })

  it('exits 0 when no command is resolved (no CLAUDE_TOOL_INPUT_COMMAND, no stdin)', () => {
    const dir = track(setupGitRepo())
    writeTaskStateFile(dir, { phase: 'close' })
    const result = spawnSync('node', [join(dir, '.claude', 'hooks', 'closer-mode-guard.mjs')], {
      env: { ...process.env, CLAUDE_TOOL_INPUT_COMMAND: '' },
      cwd: dir,
      encoding: 'utf-8',
      input: '',
    })
    expect(result.status).toBe(0)
  })
})
