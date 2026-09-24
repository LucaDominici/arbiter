// #1990: enforce-gate-before-pr.mjs is worktree-blind. It resolves the repo via
// `git rev-parse --show-toplevel` from the session cwd, so `cd <worktree> && gh pr
// create` or `gh pr create --head <branch>` (branch checked out in another worktree)
// gets validated against the WRONG tree's gate marker/HEAD. These cases prove
// resolveTargetRoot() correctly maps the command to its actual target worktree.
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import { writeGatePassEvidence } from '../helpers.js'

const HOOK_PATH = resolve(import.meta.dirname, '../../.claude/hooks/enforce-gate-before-pr.mjs')

function runHook(env: NodeJS.ProcessEnv, cwd: string): ReturnType<typeof spawnSync> {
  return spawnSync('node', [HOOK_PATH], {
    env: { ...process.env, ...env },
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000,
  })
}

function initRepo(dir: string): void {
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' })
}

function currentHead(dir: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: dir,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

function writeMarker(dir: string, headSha: string): void {
  // #2328: a REAL schema-v2 marker stamped IN `dir`, so the checkout_root axis
  // is exercised by the worktree cases rather than bypassed.
  writeGatePassEvidence(dir, { taskId: 'unknown', overrides: { head_sha: headSha } })
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

describe('enforce-gate-before-pr worktree-awareness (#1990)', () => {
  it('validates the worktree named by a leading `cd <dir> &&` segment, not the session cwd', () => {
    const main = track(mkdtempSync(join(tmpdir(), 'arbiter-gate-main-')))
    initRepo(main)
    // Main tree has NO marker — would fail if the hook validated it instead.
    const wtParent = track(mkdtempSync(join(tmpdir(), 'arbiter-gate-wt-')))
    const wtPath = join(wtParent, 'wt1')
    execFileSync('git', ['worktree', 'add', '-b', 'feature-1', wtPath], {
      cwd: main,
      stdio: 'ignore',
    })
    writeMarker(wtPath, currentHead(wtPath))

    const result = runHook(
      {
        CLAUDE_TOOL_INPUT_COMMAND: `cd ${wtPath} && gh pr create --title "feat: x" --head feature-1`,
      },
      main, // session cwd is the MAIN tree, which has no marker
    )
    expect(result.status).toBe(0)
  })

  it('resolves `--head <branch>` to the worktree where that branch is checked out', () => {
    const main = track(mkdtempSync(join(tmpdir(), 'arbiter-gate-main-')))
    initRepo(main)
    const wtParent = track(mkdtempSync(join(tmpdir(), 'arbiter-gate-wt-')))
    const wtPath = join(wtParent, 'wt2')
    execFileSync('git', ['worktree', 'add', '-b', 'feature-2', wtPath], {
      cwd: main,
      stdio: 'ignore',
    })
    writeMarker(wtPath, currentHead(wtPath))

    // No `cd` prefix this time — session cwd is main, command only names --head.
    const result = runHook(
      { CLAUDE_TOOL_INPUT_COMMAND: 'gh pr create --title "feat: y" --head feature-2' },
      main,
    )
    expect(result.status).toBe(0)
  })

  it('blocks when the target worktree (via --head) has a stale marker, even though session cwd marker is fresh', () => {
    const main = track(mkdtempSync(join(tmpdir(), 'arbiter-gate-main-')))
    initRepo(main)
    writeMarker(main, currentHead(main)) // main's OWN marker is fresh
    const wtParent = track(mkdtempSync(join(tmpdir(), 'arbiter-gate-wt-')))
    const wtPath = join(wtParent, 'wt3')
    execFileSync('git', ['worktree', 'add', '-b', 'feature-3', wtPath], {
      cwd: main,
      stdio: 'ignore',
    })
    writeMarker(wtPath, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef') // wt's marker is stale

    const result = runHook(
      { CLAUDE_TOOL_INPUT_COMMAND: 'gh pr create --title "feat: z" --head feature-3' },
      main,
    )
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('stale')
  })

  it('allows a draft for the target worktree before parsing its stale marker', () => {
    const main = track(mkdtempSync(join(tmpdir(), 'arbiter-gate-main-')))
    initRepo(main)
    const wtParent = track(mkdtempSync(join(tmpdir(), 'arbiter-gate-wt-')))
    const wtPath = join(wtParent, 'draft-wt')
    execFileSync('git', ['worktree', 'add', '-b', 'draft-feature', wtPath], {
      cwd: main,
      stdio: 'ignore',
    })
    writeMarker(wtPath, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')

    const result = runHook(
      {
        CLAUDE_TOOL_INPUT_COMMAND:
          'gh pr create --draft --title "feat: overlap" --head draft-feature',
      },
      main,
    )
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('DRAFT')
  })

  it('falls back to session-cwd resolution when no cd-prefix and no --head flag are present', () => {
    const main = track(mkdtempSync(join(tmpdir(), 'arbiter-gate-main-')))
    initRepo(main)
    writeMarker(main, currentHead(main))
    const result = runHook(
      { CLAUDE_TOOL_INPUT_COMMAND: 'gh pr create --title "feat: no-head"' },
      main,
    )
    expect(result.status).toBe(0)
  })

  it('exempts `gh issue create` even when its --body text mentions "gh pr create"', () => {
    const main = track(mkdtempSync(join(tmpdir(), 'arbiter-gate-main-')))
    initRepo(main)
    // No marker at all — if this were mis-matched as a PR-create it would block (exit 2).
    const result = runHook(
      {
        CLAUDE_TOOL_INPUT_COMMAND:
          'gh issue create --title "note" --body "remember to run gh pr create after"',
      },
      main,
    )
    expect(result.status).toBe(0)
  })

  it('matches `gh pr create` as a chained segment after `&&`, not just a full-string prefix', () => {
    const main = track(mkdtempSync(join(tmpdir(), 'arbiter-gate-main-')))
    initRepo(main)
    // No marker — segment-anchored match on the second `&&` segment must still catch it.
    const result = runHook(
      { CLAUDE_TOOL_INPUT_COMMAND: 'npm run build && gh pr create --title "feat: chained"' },
      main,
    )
    expect(result.status).toBe(2)
  })

  it('does not treat a `cd`-only command (no gh pr create) as a PR completion claim', () => {
    const main = track(mkdtempSync(join(tmpdir(), 'arbiter-gate-main-')))
    initRepo(main)
    const result = runHook({ CLAUDE_TOOL_INPUT_COMMAND: 'cd /tmp && ls' }, main)
    expect(result.status).toBe(0)
  })

  it.each([
    'printf hello > /tmp/example',
    'printf "$(date)"',
    "printf '$(gh pr ready)' > /tmp/example",
  ])('allows unsupported shell syntax when no PR completion claim exists: %s', (command) => {
    const main = track(mkdtempSync(join(tmpdir(), 'arbiter-gate-main-')))
    initRepo(main)
    const result = runHook({ CLAUDE_TOOL_INPUT_COMMAND: command }, main)
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
  })

  it.each([
    'gh pr create > /tmp/example',
    '$(gh pr create)',
    'printf "$(gh pr ready)"',
    'printf "$(date; gh pr ready)"',
    'printf `gh pr ready`',
  ])('keeps an ambiguous PR completion claim fail-closed: %s', (command) => {
    const main = track(mkdtempSync(join(tmpdir(), 'arbiter-gate-main-')))
    initRepo(main)
    const result = runHook({ CLAUDE_TOOL_INPUT_COMMAND: command }, main)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('No valid gate-pass.json or ci-pass.json')
  })
})

// #2862: a quoted cat heredoc body is blanked only when every segment runs gh or git, so text an
// interpreter would execute keeps the original parse.
describe('enforce-gate-before-pr heredoc data (#2862)', () => {
  it.each([
    ['heredoc data evaluated', 'eval "$(cat <<\'EOF\'\ngh pr create\nEOF\n)"'],
    ['heredoc data piped into a shell', 'printf %s "$(cat <<\'EOF\'\ngh pr ready\nEOF\n)" | bash'],
  ])('keeps %s blocked', (_label, command) => {
    const dir = track(mkdtempSync(join(tmpdir(), 'arbiter-gate-heredoc-')))
    initRepo(dir)
    expect(runHook({ CLAUDE_TOOL_INPUT_COMMAND: command }, dir).status).toBe(2)
  })
})

// #2862 review: an output redirection or a read-only filter after a draft creation leaves it a
// draft; input redirection, background `&` and command substitution stay ambiguous. Text a shell
// runs through `-c` or `eval` is shell, so a PR command inside it is guarded; the quoted
// arguments of any other command stay data.
describe('enforce-gate-before-pr shell forms (#2862 review)', () => {
  function hookIn(command: string): ReturnType<typeof spawnSync> {
    const dir = track(mkdtempSync(join(tmpdir(), 'arbiter-gate-forms-')))
    initRepo(dir)
    return runHook({ CLAUDE_TOOL_INPUT_COMMAND: command }, dir)
  }

  it.each([
    'gh pr create --draft --title T --body-file F 2>&1 | tail -1',
    'gh pr create --draft --fill > /tmp/pr-url',
    'gh pr create --draft --fill >> /tmp/pr-url',
    'gh pr create --draft --fill 2>/dev/null',
    'gh pr create --draft --fill &> /tmp/pr-url',
    'gh pr create --draft --fill >/dev/null 2>&1',
    'cd /tmp && gh pr create --draft --fill 2>&1 | grep -o "https://[^ ]*"',
  ])('recognizes a redirected or filtered draft creation: %s', (command) => {
    const result = hookIn(command)
    expect(result.status, String(result.stderr)).toBe(0)
    expect(result.stderr).toContain('DRAFT')
  })

  it.each([
    'gh pr create --draft --fill < /tmp/body',
    'gh pr create --draft --fill &',
    'gh pr create --draft --fill > "$(gh pr ready)"',
    'gh pr create --draft --fill > >(cat)',
    'gh pr create --title >/tmp/x --draft',
    'gh pr create --draft --fill 2>&1 | xargs gh pr ready',
  ])('keeps an ambiguous or non-draft redirection blocked: %s', (command) => {
    expect(hookIn(command).status).toBe(2)
  })

  it.each([
    'bash -c "gh pr create --fill"',
    "sh -c 'gh pr ready 12'",
    'zsh -c "gh pr create --fill"',
    'bash -lc "gh pr create --fill"',
    'env bash -c "gh pr create --fill"',
    'eval "gh pr create --fill"',
    'bash -c "sh -c \'gh pr create --fill\'"',
    'bash -c "true; eval \'gh pr ready\'"',
    'bash -c "gh pr create --draft --fill"',
  ])('guards a PR command a shell runs from its -c or eval payload: %s', (command) => {
    const result = hookIn(command)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('No valid gate-pass.json or ci-pass.json')
  })

  it.each([
    'gh issue create --title t --body "bash -c \'gh pr create --fill\'"',
    'gh issue comment 1 --body "eval gh pr create --fill"',
    'git commit -m "sh -c \\"gh pr ready\\""',
    'gh issue create --title t --body "$(cat <<\'EOF\'\nbash -c "gh pr create --fill"\nEOF\n)"',
    'bash -c "echo done" > /tmp/out',
  ])('treats a quoted argument of another command as data: %s', (command) => {
    const result = hookIn(command)
    expect(result.status, String(result.stderr)).toBe(0)
    expect(result.stderr).toBe('')
  })
})
