// SPDX-License-Identifier: Apache-2.0
/**
 * #2919 — `gateLockPathFor` (scripts/lib/gate-mutex.mjs:70) resolves the lock
 * key by shelling out to `git rev-parse --git-common-dir` in `dir`, but the
 * `execFileSync` call passes no `env`, so it inherits the caller's full
 * `process.env` unfiltered. A caller (or a hook, or a nested subprocess) that
 * has `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` set to point at a DIFFERENT
 * repo makes `git rev-parse` resolve that other repo's common dir instead of
 * `dir`'s — the two repos then converge on the SAME gate lock, defeating the
 * per-repo mutex (#2427 AC-2). Measured on origin/main (d70eb7c7):
 * `GIT_DIR=<arbiter>/.git npx vitest run gate-mutex.test.ts -t 'ONE lock
 * path'` passes vacuously because both sides resolve the parent's common dir.
 *
 * This file targets `gateLockPathFor` directly (not the existing suite's
 * fixture), with two independent, non-vacuous repos so an env leak is
 * observable even if the leaked env happens to also satisfy the OTHER
 * repo's own worktree convergence.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gateLockPathFor } from '../../scripts/lib/gate-mutex.mjs'

const dirs: string[] = []
function track(dir: string): string {
  dirs.push(dir)
  return dir
}
afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function makeRepo(prefix: string): string {
  const dir = track(realpathSync(mkdtempSync(join(tmpdir(), `arbiter-2919-${prefix}-`))))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  return dir
}

const LEAKY_VARS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'] as const

describe('#2919 — gateLockPathFor ignores inherited GIT_DIR/GIT_WORK_TREE', () => {
  it("an inherited GIT_DIR pointing at repo B does not steal repo A's lock path", () => {
    const repoA = makeRepo('a')
    const repoB = makeRepo('b')
    // Non-vacuity: with no hostile env, the two repos are provably distinct locks.
    const honestLockPathA = gateLockPathFor(repoA)
    expect(honestLockPathA).not.toBe(gateLockPathFor(repoB))

    // Simulate a caller (a hook, a nested subprocess) that already exported
    // GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE for repo B into THIS process's real
    // env before calling gateLockPathFor(repoA) — the actual inheritance path
    // `execFileSync('git', …, { cwd: dir })` is exposed to, since it passes no
    // explicit `env` and no `dir`-scoped override exists today.
    const saved: Record<string, string | undefined> = {}
    for (const key of LEAKY_VARS) saved[key] = process.env[key]
    try {
      process.env.GIT_DIR = join(repoB, '.git')
      process.env.GIT_WORK_TREE = repoB
      process.env.GIT_INDEX_FILE = join(repoB, '.git', 'index')

      // gateLockPathFor(repoA) must still resolve repo A's own lock path, not
      // repo B's — the whole point of a per-repo mutex (#2427 AC-2).
      expect(gateLockPathFor(repoA)).toBe(honestLockPathA)
      expect(gateLockPathFor(repoA)).not.toBe(gateLockPathFor(repoB))
    } finally {
      for (const key of LEAKY_VARS) {
        if (saved[key] === undefined) Reflect.deleteProperty(process.env, key)
        else process.env[key] = saved[key]
      }
    }
  })
})
