// SPDX-License-Identifier: Apache-2.0
// T3 of #1873 (ADR-103): `arbiter gate-exec` — per-repo gate mutex primitive.
// Key derivation is per-REPO (git-common-dir), so every worktree of the same
// repo converges on the same lock; execution delegates to flock(1) (kernel
// releases the lock on SIGKILL/OOM — the hole Node cleanup handlers cannot
// cover); absence of flock is a hard, explicit error (fail-closed).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import {
  deriveGateKey,
  gateLockPath,
  assertFlockAvailable,
  gateExecArgv,
  runGateExec,
} from '../../src/commands/gate-exec.js'

function initGitRepo(dir: string): void {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
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

  it('composes a blocking flock argv: flock -- <lock> <cmd...>', () => {
    const argv = gateExecArgv('/run/arbiter/k-gate.lock', ['npm', 'test'])
    expect(argv).toEqual(['flock', '--', '/run/arbiter/k-gate.lock', 'npm', 'test'])
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
