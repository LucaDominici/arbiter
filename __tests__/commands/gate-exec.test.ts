// SPDX-License-Identifier: Apache-2.0
// T3 of #1873 (ADR-103): `arbiter gate-exec` — per-repo gate mutex primitive.
// Key derivation is per-REPO (git-common-dir), so every worktree of the same
// repo converges on the same lock; execution delegates to flock(1) (kernel
// releases the lock on SIGKILL/OOM — the hole Node cleanup handlers cannot
// cover); absence of flock is a hard, explicit error (fail-closed).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import {
  deriveGateKey,
  gateLockPath,
  assertFlockAvailable,
  gateExecArgv,
  runGateExec,
  gateQueueAdvisory,
} from '../../src/commands/gate-exec.js'
import {
  spawnLockHolder,
  killLockHolder,
  isAlive,
  pollUntil,
  OBSERVE_BUDGET_MS,
} from '../helpers/lock-holder.js'

function initGitRepo(dir: string): void {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  // CI runners have no global git identity — configure a local one so the
  // worktree-derivation test can create a commit.
  execFileSync('git', ['config', 'user.email', 'test@arbiter.dev'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'Arbiter Test'], { cwd: dir })
}

describe('gate-exec (#1873 T3)', () => {
  let repoA: string
  let repoB: string

  beforeEach(() => {
    repoA = mkdtempSync(join(tmpdir(), 'arbiter-gate-a-'))
    repoB = mkdtempSync(join(tmpdir(), 'arbiter-gate-b-'))
    initGitRepo(repoA)
    initGitRepo(repoB)
  })

  afterEach(() => {
    rmSync(repoA, { recursive: true, force: true })
    rmSync(repoB, { recursive: true, force: true })
  })

  // ── key derivation ─────────────────────────────────────────────────────────

  it('derives the SAME key from the repo root and a subdirectory (per-repo key)', () => {
    const sub = join(repoA, 'src')
    execFileSync('mkdir', ['-p', sub])
    expect(deriveGateKey(sub)).toBe(deriveGateKey(repoA))
  })

  it('derives the SAME key from a linked worktree as from the main repo', () => {
    execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'init'], { cwd: repoA })
    const wt = join(repoA, '..', `${basename(repoA)}-wt`)
    execFileSync('git', ['worktree', 'add', '-q', '-b', 'wt-branch', wt], { cwd: repoA })
    try {
      expect(deriveGateKey(wt)).toBe(deriveGateKey(repoA))
    } finally {
      execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: repoA })
    }
  })

  it('derives DIFFERENT keys for different repos', () => {
    expect(deriveGateKey(repoA)).not.toBe(deriveGateKey(repoB))
  })

  // ── lock path ──────────────────────────────────────────────────────────────

  it('lock path lives under XDG_RUNTIME_DIR/arbiter when set', () => {
    const runtimeDir = mkdtempSync(join(tmpdir(), 'arbiter-xdg-'))
    try {
      const p = gateLockPath('abc123', { XDG_RUNTIME_DIR: runtimeDir })
      expect(p).toBe(join(runtimeDir, 'arbiter', 'abc123-gate.lock'))
      expect(existsSync(dirname(p))).toBe(true) // parent dir created
    } finally {
      rmSync(runtimeDir, { recursive: true, force: true })
    }
  })

  it('lock path falls back to the OS tmpdir without XDG_RUNTIME_DIR', () => {
    const p = gateLockPath('abc123', {})
    expect(p).toBe(join(tmpdir(), 'arbiter', 'abc123-gate.lock'))
  })

  // ── fail-closed when flock(1) is missing ──────────────────────────────────

  it('assertFlockAvailable throws E_GATE_MUTEX_UNSUPPORTED when flock is not on PATH', () => {
    const masked = { ...process.env, PATH: '/nonexistent-bin' }
    expect(() => assertFlockAvailable(masked)).toThrow(/E_GATE_MUTEX_UNSUPPORTED|flock/)
    try {
      assertFlockAvailable(masked)
      expect.unreachable('should have thrown')
    } catch (e) {
      expect((e as { code?: string }).code).toBe('E_GATE_MUTEX_UNSUPPORTED')
      // Actionable hint: serial fallback or install flock.
      expect((e as Error).message).toMatch(/--max-parallel 1/)
    }
  })

  it('assertFlockAvailable passes on a POSIX box with util-linux flock', () => {
    expect(() => assertFlockAvailable()).not.toThrow()
  })

  // ── argv composition (what gate-exec execs) ────────────────────────────────

  it('composes a blocking close-on-exec flock argv: flock -o -- <lock> <cmd...>', () => {
    const argv = gateExecArgv('/run/arbiter/k-gate.lock', ['npm', 'test'])
    expect(argv).toEqual(['flock', '-o', '--', '/run/arbiter/k-gate.lock', 'npm', 'test'])
  })

  // ── execution: exit-code passthrough under the real flock ─────────────────

  it('runGateExec passes the child exit code through (real flock)', () => {
    const code = runGateExec({ cmdArgs: ['sh', '-c', 'exit 7'], dir: repoA })
    expect(code).toBe(7)
  })

  it('runGateExec returns 0 for a green command and honours --key override', () => {
    const code = runGateExec({ cmdArgs: ['true'], dir: repoA, key: 'custom-key' })
    expect(code).toBe(0)
  })
})

// ── #2098: queue-depth advisory (shares the waiter-count helper with capacity-probe.mjs) ──

describe('gateQueueAdvisory (#2098)', () => {
  let dir: string
  let lockPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-gate-advisory-'))
    lockPath = join(dir, 'gate.lock')
    writeFileSync(lockPath, '')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns null when the target project has no scripts/lib/waiter-count.mjs (helper absent)', () => {
    expect(gateQueueAdvisory(dir, lockPath)).toBeNull()
  })

  it('returns null (advisory only, never throws) when the helper file is broken', () => {
    mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true })
    writeFileSync(join(dir, 'scripts', 'lib', 'waiter-count.mjs'), 'this is not valid js {{{')
    expect(gateQueueAdvisory(dir, lockPath)).toBeNull()
  })

  it('returns null when queue depth is below the >= 2 threshold (nobody holds the lock)', () => {
    mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true })
    copyFileSync(
      resolve('scripts/lib/waiter-count.mjs'),
      join(dir, 'scripts', 'lib', 'waiter-count.mjs'),
    )
    expect(gateQueueAdvisory(dir, lockPath)).toBeNull()
  })

  it('names the queue depth and the sanctioned bypass alternative once depth reaches 2', async () => {
    mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true })
    copyFileSync(
      resolve('scripts/lib/waiter-count.mjs'),
      join(dir, 'scripts', 'lib', 'waiter-count.mjs'),
    )
    // Same #2282 fixture as waiter-count.test.ts: the old inline `sleep 2` matched the
    // 2000 ms budget exactly, and each iteration here spawns a whole `node` (not just
    // `fuser`), so this loop was both the most fragile and the most expensive of the two.
    const holderA = spawnLockHolder(lockPath, [])
    const holderB = spawnLockHolder(lockPath, [])
    try {
      const advisory = await pollUntil(
        () => gateQueueAdvisory(dir, lockPath),
        (a) => a !== null,
        OBSERVE_BUDGET_MS,
      )
      expect(advisory).not.toBeNull()
      expect(advisory).toContain('ARBITER_PREPUSH_BYPASS')
      expect(isAlive(holderA)).toBe(true)
      expect(isAlive(holderB)).toBe(true)
    } finally {
      killLockHolder(holderA)
      killLockHolder(holderB)
    }
  })
})
