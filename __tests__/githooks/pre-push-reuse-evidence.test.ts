// SPDX-License-Identifier: Apache-2.0
/**
 * Pre-push green-evidence reuse (skip redundant gate rerun) — behavioural tests.
 *
 * The host `.githooks/pre-push` runs the full L2 gate unconditionally at the
 * bottom. When check-all.mjs has already stamped a GREEN result for the EXACT
 * current HEAD (`.arbiter/gate-pass.json`), produced from a clean tree, under a
 * matching node version, within the freshness window, the hook may reuse that
 * evidence and skip the (multi-minute) rerun.
 *
 * These tests are DEFEAT-oriented: every field that could make the stamp NOT
 * correspond to what is being pushed must force a full rerun (fail-closed). We
 * exercise the REAL shipped bash+node-e — not a reimplementation — with a
 * check-all.mjs stub that FAILS (exit 1) and writes a sentinel when it runs:
 *   - skip fired   ⟺ hook exits 0, loud reuse line on stdout, stub sentinel absent
 *   - no skip      ⟺ hook exits ≠0 (the failing stub ran), sentinel present
 *
 * TRUST BOUNDARY: the stamp is a plain JSON file; a local process could forge
 * it. This is a local-convenience skip, not a security control — CI re-runs the
 * full gate independently. The "valid stamp → skip" case documents exactly that
 * a well-formed local stamp is honoured by design.
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  copyFileSync,
  chmodSync,
} from 'node:fs'
import { spawnSync, execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { materializeGateEvidenceLib, writeGatePassEvidence } from '../helpers.js'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const REPO_ROOT = resolve(__dirname, '..', '..')
const HOOK_SRC = join(REPO_ROOT, '.githooks', 'pre-push')

// #2328: schema-v2 markers are BUILT by the real writer, never hand-written —
// a hand-maintained literal is how a fixture ends up with an empty field that
// silently disables an axis. Each case plants one override on a built marker.
type Stamp = Record<string, unknown>

interface SetupOpts {
  /** null → do not write a stamp at all. Otherwise overrides merged over a valid stamp. */
  stamp?: Partial<Stamp> | null
  /** Add a second commit AFTER stamping so HEAD advances past the stamp's head_sha. */
  advanceHeadAfterStamp?: boolean
}

interface RunResult {
  status: number
  stdout: string
  stderr: string
  stubRan: boolean
}

function setupRepo(opts: SetupOpts = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-reuse-'))
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@arbiter.dev'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Arbiter Test'], { cwd: dir, stdio: 'ignore' })

  // node_modules must exist or the hook bails out early with exit 0 (masking everything).
  mkdirSync(join(dir, 'node_modules'), { recursive: true })

  // #2328: the reuse decision is delegated to the shared verifier, co-emitted
  // into every project at scripts/lib/gate-evidence.mjs.
  materializeGateEvidenceLib(dir)

  // check-all stub: FAILS (exit 1) and drops a sentinel so we can prove it ran.
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  writeFileSync(
    join(dir, 'scripts', 'check-all.mjs'),
    "#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs'\nwriteFileSync('STUB_RAN', '1')\nprocess.exit(1)\n",
    { mode: 0o755 },
  )

  const hookDest = join(dir, '.githooks', 'pre-push')
  mkdirSync(join(dir, '.githooks'), { recursive: true })
  copyFileSync(HOOK_SRC, hookDest)
  chmodSync(hookDest, 0o755)

  // Single commit → clean tree, known HEAD.
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], {
    cwd: dir,
    stdio: 'ignore',
  })

  if (opts.stamp !== null) {
    // Written AFTER the commit → stays untracked (?? …); the porcelain check
    // ignores untracked, so the working tree is still "clean" for the hook, and
    // the tree hash excludes `.arbiter/` by construction.
    writeGatePassEvidence(dir, { taskId: 'unknown', overrides: opts.stamp ?? {} })
  }

  if (opts.advanceHeadAfterStamp) {
    // A real "HEAD moved after the stamp" scenario: the stamp still names the
    // parent, but the tip is now a different commit.
    writeFileSync(join(dir, 'another.txt'), 'more\n')
    execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' })
    execFileSync('git', ['commit', '-q', '-m', 'advance'], { cwd: dir, stdio: 'ignore' })
  }

  return dir
}

function runHook(dir: string, env: Record<string, string> = {}): RunResult {
  const result = spawnSync('/usr/bin/bash', ['.githooks/pre-push'], {
    cwd: dir,
    encoding: 'utf-8',
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: process.env.HOME ?? '/tmp',
      ...env,
    },
  })
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    stubRan: existsSync(join(dir, 'STUB_RAN')),
  }
}

describe('.githooks/pre-push — green-evidence reuse (skip redundant rerun)', () => {
  let dir: string

  afterEach(() => {
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  })

  it('valid fresh stamp for HEAD (clean, L2, matching node) → SKIPS the rerun', () => {
    dir = setupRepo({ stamp: {} })
    const r = runHook(dir)
    expect(r.status).toBe(0)
    expect(r.stubRan).toBe(false)
    expect(r.stdout).toMatch(/reusing green L2 evidence/)
  })

  it('no stamp present → runs the full gate (no skip)', () => {
    dir = setupRepo({ stamp: null })
    const r = runHook(dir)
    expect(r.status).not.toBe(0)
    expect(r.stubRan).toBe(true)
  })

  it('stamp names the PARENT commit but HEAD moved → must NOT skip', () => {
    dir = setupRepo({ stamp: {}, advanceHeadAfterStamp: true })
    const r = runHook(dir)
    expect(r.status).not.toBe(0)
    expect(r.stubRan).toBe(true)
  })

  it('stamp made on a DIRTY tree (tree_was_clean_at_run_time=false) → must NOT skip', () => {
    dir = setupRepo({ stamp: { tree_was_clean_at_run_time: false } })
    const r = runHook(dir)
    expect(r.status).not.toBe(0)
    expect(r.stubRan).toBe(true)
  })

  it('stamp level is L1 (not the L2 the hook runs) → must NOT skip', () => {
    dir = setupRepo({ stamp: { level: 'L1' } })
    const r = runHook(dir)
    expect(r.status).not.toBe(0)
    expect(r.stubRan).toBe(true)
  })

  it('stamp node_version differs from the running node → must NOT skip', () => {
    dir = setupRepo({ stamp: { node_version: 'v0.0.0-not-this-node' } })
    const r = runHook(dir)
    expect(r.status).not.toBe(0)
    expect(r.stubRan).toBe(true)
  })

  it('stamp older than the freshness budget → must NOT skip', () => {
    const stale = new Date(Date.now() - 300 * 60 * 1000).toISOString() // 300 min, budget 240
    dir = setupRepo({ stamp: { timestamp: stale } })
    const r = runHook(dir)
    expect(r.status).not.toBe(0)
    expect(r.stubRan).toBe(true)
  })

  it('malformed stamp JSON → must NOT skip (fail-closed)', () => {
    dir = setupRepo({ stamp: {} })
    writeFileSync(join(dir, '.arbiter', 'gate-pass.json'), '{ not valid json')
    const r = runHook(dir)
    expect(r.status).not.toBe(0)
    expect(r.stubRan).toBe(true)
  })
})
