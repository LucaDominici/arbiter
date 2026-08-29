// #2403: stop-dangerous.mjs's protected-Arbiter-state-write guard used to scan free
// TEXT for an evidence path plus a write-ish word anywhere in a command segment —
// including inside a quoted string — so it false-blocked `gh issue create --body
// "rm ...evidence..."` and the ship playbook's own `node -e` evidence writers. The
// hook is spawned from its REAL path in the repo (not copied into a temp fixture) so
// its `./lib.mjs` import resolves normally — mirrors
// __tests__/hooks/empirical/pre-spawn-worktree-guard.test.ts. stop-dangerous.mjs has
// no filesystem/repo-root dependency, so no tmpdir/git setup is needed — only the
// command is varied via CLAUDE_TOOL_INPUT_COMMAND.
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const HOOK_PATH = resolve(import.meta.dirname, '../../../.claude/hooks/stop-dangerous.mjs')

function runHook(command: string): ReturnType<typeof spawnSync> {
  return spawnSync('node', [HOOK_PATH], {
    encoding: 'utf-8',
    input: '',
    env: { ...process.env, CLAUDE_TOOL_INPUT_COMMAND: command },
  })
}

describe('stop-dangerous hook protected-Arbiter-state-write guard (#2403)', () => {
  it('exits 2: rm on an evidence file', () => {
    const result = runHook('rm .arbiter/evidence/x.json')
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Blocked protected Arbiter state write')
  })

  it('exits 2: truncate on gate-pass.json', () => {
    const result = runHook('truncate -s0 .arbiter/gate-pass.json')
    expect(result.status).toBe(2)
  })

  it('exits 2: redirect (>) onto an evidence file', () => {
    const result = runHook('echo x > .arbiter/evidence/y.json')
    expect(result.status).toBe(2)
  })

  it('exits 0: free-text mention inside a quoted gh issue body', () => {
    const result = runHook('gh issue create --body "rm .arbiter/evidence/x"')
    expect(result.status).toBe(0)
  })

  it('exits 0: node -e evidence writer (the ship playbook pattern)', () => {
    const result = runHook(
      'node -e \'require("fs").writeFileSync(".arbiter/evidence/tdd/x.json","{}")\'',
    )
    expect(result.status).toBe(0)
  })

  it('exits 0: node scripts/*.mjs evidence writer', () => {
    const result = runHook('node scripts/done-evidence.mjs')
    expect(result.status).toBe(0)
  })

  it('exits 2: sed -i on an evidence file', () => {
    const result = runHook('sed -i s/a/b/ .arbiter/evidence/x.json')
    expect(result.status).toBe(2)
  })

  it('exits 0: cat/printf/echo reading an evidence path without a redirect', () => {
    expect(runHook('cat .arbiter/evidence/x.json').status).toBe(0)
    expect(runHook('printf "%s" .arbiter/evidence/x.json').status).toBe(0)
    expect(runHook('echo .arbiter/evidence/x.json').status).toBe(0)
  })

  it('exits 0: arbiter/git/gh commands referencing evidence paths', () => {
    expect(runHook('arbiter task get --evidence .arbiter/evidence/x.json').status).toBe(0)
    expect(runHook('git add .arbiter/evidence/x.json').status).toBe(0)
  })

  it('still blocks the pre-existing dangerous-command rules unchanged', () => {
    expect(runHook('rm -rf /').status).toBe(2)
    expect(runHook('git push --force').status).toBe(2)
  })
})
