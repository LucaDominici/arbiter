// SPDX-License-Identifier: Apache-2.0
// Covers the actual codex-dispatch.mjs CLI (not just the argv builder it calls): proves the
// spawned `codex` process runs with cwd = the target worktree, regardless of the invoker's own
// cwd. Regression guard for lesson 33 (SHIP_REDESIGN_JOURNAL.md) — deleting `cwd: worktreePath`
// from the spawnSync call would leave codex-dispatch-lib.test.ts fully green while breaking this.
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DISPATCH_SCRIPT = join(__dirname, '../../scripts/codex-dispatch.mjs')

describe('codex-dispatch CLI', () => {
  it('spawns codex with cwd set to the target worktree, not the caller cwd', () => {
    const hub = mkdtempSync(join(tmpdir(), 'codex-dispatch-cli-'))
    try {
      const worktree = join(hub, 'writer')
      const callerCwd = join(hub, 'caller')
      const fakeBin = join(hub, 'bin')
      const pwdOut = join(hub, 'observed-pwd.txt')
      const brief = join(hub, 'brief.txt')
      const out = join(hub, 'out.txt')

      mkdirSync(worktree, { recursive: true })
      mkdirSync(callerCwd, { recursive: true })
      mkdirSync(fakeBin, { recursive: true })
      execFileSync('git', ['init'], { cwd: worktree })
      writeFileSync(brief, 'noop')

      // Stub `codex` on PATH: records its own cwd, ignoring every argument.
      const fakeCodex = join(fakeBin, 'codex')
      writeFileSync(fakeCodex, `#!/bin/sh\npwd > "${pwdOut}"\n`)
      chmodSync(fakeCodex, 0o755)

      execFileSync(
        process.execPath,
        [
          DISPATCH_SCRIPT,
          '--worktree',
          worktree,
          '--model',
          'stub',
          '--effort',
          'low',
          '--brief',
          brief,
          '--out',
          out,
        ],
        { cwd: callerCwd, env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } },
      )

      const observedCwd = readFileSync(pwdOut, 'utf8').trim()
      const realWorktree = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: worktree,
        encoding: 'utf8',
      }).trim()
      expect(observedCwd).toBe(realWorktree)
      expect(observedCwd).not.toBe(callerCwd)
    } finally {
      rmSync(hub, { recursive: true, force: true })
    }
  })
})
