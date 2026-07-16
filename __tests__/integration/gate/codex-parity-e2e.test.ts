// SPDX-License-Identifier: Apache-2.0
// Codex-track parity contract — spawn/bake-heavy E2E (ADR-106, #1966).
//
// INTEGRATION scope by repo taxonomy: every test here spawns the real gate
// entrypoint (node scripts/check-codex-parity.mjs) and/or a full CLI bake —
// 90-125s under an instrumented coverage run on a contended runner, which is
// why they must NOT live in the unit scope (vitest.config.ts) that the
// coverage gate executes. The pure in-process suite stays in
// __tests__/scripts/check-codex-parity.test.ts and carries the src/ coverage.

import { describe, it, expect } from 'vitest'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanChildEnv } from '../../../scripts/check-codex-parity.mjs'
import { bakeBothTracks, cleanupBake, dropCanon22 } from '../../scripts/codex-parity-fixture.js'

const execFileAsync = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..', '..')
const CHECK_SCRIPT = join(repoRoot, 'scripts', 'check-codex-parity.mjs')

describe('check-codex-parity.mjs — fixture concurrency (hardening 10)', () => {
  it('two CONCURRENT spawned checks over separate bakes do not cross-contaminate', async () => {
    const dirA = bakeBothTracks()
    const dirB = bakeBothTracks()
    try {
      dropCanon22(dirB)
      const spawn = (baked: string) =>
        execFileAsync('node', [CHECK_SCRIPT, '--baked-dir', baked], {
          encoding: 'utf-8',
          env: cleanChildEnv(),
          cwd: repoRoot,
          timeout: 120_000,
        }).then(
          (r) => ({ code: 0, stdout: r.stdout }),
          (e: { code?: number; stdout?: string }) => ({
            code: e.code ?? -1,
            stdout: e.stdout ?? '',
          }),
        )
      const [clean, drifted] = await Promise.all([spawn(dirA), spawn(dirB)])
      // Isolation: the mutation in B must not bleed into A. In fixture mode
      // the repo-history baseline sub-check is skipped explicitly (both runs
      // state it), so the clean bake is fully green and the mutated one is
      // red on the drift alone.
      expect(clean.code, `clean fixture must pass, got: ${clean.stdout}`).toBe(0)
      expect(clean.stdout).not.toContain('derived-drift')
      expect(clean.stdout).toContain('baseline: skipped — fixture mode')
      expect(drifted.code).toBe(1)
      expect(drifted.stdout).toContain('derived-drift')
      expect(drifted.stdout).toContain('baseline: skipped — fixture mode')
    } finally {
      cleanupBake(dirA)
      cleanupBake(dirB)
    }
  }, 180_000)
})

describe('shallow-clone fail-closed (spawned, hardening 17)', () => {
  it('exits 2 with remediation when origin/main history is missing', () => {
    const cloneDir = mkdtempSync(join(tmpdir(), 'arbiter-parity-shallow-'))
    try {
      execFileSync(
        'git',
        ['clone', '--depth', '1', '--quiet', `file://${repoRoot}`, join(cloneDir, 'repo')],
        { encoding: 'utf-8' },
      )
      const shallowRepo = join(cloneDir, 'repo')
      // the script only needs node stdlib + minimatch — reuse the real node_modules
      symlinkSync(join(repoRoot, 'node_modules'), join(shallowRepo, 'node_modules'))
      let exitCode = 0
      let stderr = ''
      try {
        execFileSync('node', [join(shallowRepo, 'scripts', 'check-codex-parity.mjs')], {
          encoding: 'utf-8',
          env: cleanChildEnv(),
          cwd: shallowRepo,
        })
      } catch (err) {
        const e = err as { status?: number; stderr?: string }
        exitCode = e.status ?? -1
        stderr = e.stderr ?? ''
      }
      expect(exitCode, 'must fail closed (exit 2), never skip silently').toBe(2)
      expect(stderr).toContain('fails closed')
    } finally {
      rmSync(cloneDir, { recursive: true, force: true })
    }
  }, 120_000)
})

describe('check-codex-parity.mjs end to end', () => {
  /** True when repo-mode can run here (merge-base with origin/main resolves). */
  function mergeBaseResolvable(): boolean {
    try {
      execFileSync('git', ['merge-base', 'origin/main', 'HEAD'], {
        encoding: 'utf-8',
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      return true
    } catch {
      return false
    }
  }

  // Repo-mode contract is environment-dependent BY DESIGN (hardening 17):
  // where merge-base resolves (local dev, gate-full with fetch-depth 0) the
  // full run must be green WITH the baseline checked; on a shallow checkout
  // the same invocation must fail CLOSED with exit 2 and remediation text —
  // never a silent skip. Both branches assert a real contract, so this test
  // is meaningful in every environment it runs in.
  it('full run: green with baseline checked where merge-base resolves; fail-closed exit 2 on shallow history', async () => {
    if (mergeBaseResolvable()) {
      const { stdout } = await execFileAsync('node', [CHECK_SCRIPT], {
        encoding: 'utf-8',
        env: cleanChildEnv(),
        cwd: repoRoot,
        timeout: 240_000,
      })
      expect(stdout).toContain('check-codex-parity: OK')
      expect(stdout).toMatch(/parity-surface: (\d+)\/\1 \(100%\)/)
      // repo-mode NEVER skips the baseline sub-check
      expect(stdout).not.toContain('baseline: skipped')
    } else {
      let exitCode = 0
      let stderr = ''
      try {
        await execFileAsync('node', [CHECK_SCRIPT], {
          encoding: 'utf-8',
          env: cleanChildEnv(),
          cwd: repoRoot,
          timeout: 240_000,
        })
      } catch (err) {
        const e = err as { code?: number; stderr?: string }
        exitCode = e.code ?? -1
        stderr = e.stderr ?? ''
      }
      expect(exitCode, 'shallow history must fail closed (exit 2), never skip silently').toBe(2)
      expect(stderr).toContain('fails closed')
      expect(stderr).toContain('fetch-depth: 0')
    }
  }, 300_000)

  it('drift injected into a pre-baked tree turns the spawned check red (fixture mode, baseline explicitly skipped)', async () => {
    const bakeDir = bakeBothTracks()
    try {
      dropCanon22(bakeDir)
      let failed = false
      let stdout = ''
      try {
        await execFileAsync('node', [CHECK_SCRIPT, '--baked-dir', bakeDir], {
          encoding: 'utf-8',
          env: cleanChildEnv(),
          cwd: repoRoot,
          timeout: 120_000,
        })
      } catch (err) {
        const e = err as { code?: number; stdout?: string }
        failed = e.code === 1
        stdout = e.stdout ?? ''
      }
      expect(failed, 'spawned check must exit 1 on injected drift').toBe(true)
      expect(stdout).toContain('derived-drift')
      // fixture mode: the repo-history baseline sub-check is skipped LOUDLY,
      // not silently — the classification still ran (that's what went red).
      expect(stdout).toContain('baseline: skipped — fixture mode')
    } finally {
      cleanupBake(bakeDir)
    }
  }, 180_000)

  it('clean pre-baked tree passes in fixture mode with the baseline skip stated', async () => {
    const bakeDir = bakeBothTracks()
    try {
      const { stdout } = await execFileAsync('node', [CHECK_SCRIPT, '--baked-dir', bakeDir], {
        encoding: 'utf-8',
        env: cleanChildEnv(),
        cwd: repoRoot,
        timeout: 120_000,
      })
      expect(stdout).toContain('check-codex-parity: OK')
      expect(stdout).toContain('baseline: skipped — fixture mode')
    } finally {
      cleanupBake(bakeDir)
    }
  }, 180_000)
})
