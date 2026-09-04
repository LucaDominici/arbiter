// SPDX-License-Identifier: Apache-2.0
/**
 * #2328 — the FOUR consumers of `.arbiter/gate-pass.json` must all honour the
 * schema-v2 binding. Missing one leaves the hole open, so each consumer gets
 * both halves of the proof here:
 *
 *   1. `arbiter task advance`            (src/commands/task.ts)
 *   2. `enforce-gate-before-pr.mjs`      (blocks `gh pr create`)
 *   3. `stop-evidence-guard.mjs`         (blocks a completion claim)
 *   4. `.githooks/pre-push` reuse rule   (#2085 — skips a redundant L2)
 *
 * The planted defect is the same on every consumer — evidence produced in
 * worktree A, verified in worktree B — because it is the axis NO consumer
 * checked before this change, and because a clone keeps head_sha, branch, tree
 * content and toolchain identical so `checkout_root` is the only discriminator.
 * Each consumer also gets a happy-path control: a gate that rejects everything
 * would otherwise score full marks.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildGateEvidence, captureGateStart } from '../../scripts/lib/gate-evidence.mjs'
import { runTaskAdvance } from '../../src/commands/task.js'
import { writeTaskStateFile } from '../helpers.js'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TASK_ID = '#2328'
const BRANCH = 'task/2328-consumers'

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

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8' }).trim()
}

/** The shared verifier, as a project would carry it. */
function installGateEvidenceLib(dir: string): void {
  mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true })
  // #2427: gate-mutex.mjs joins the set — the pre-push consumer below launches
  // the gate THROUGH it, so a fixture without it never reaches the stub at all.
  for (const file of ['gate-evidence.mjs', 'gate-mutex.mjs', 'run-helpers.mjs']) {
    copyFileSync(join(REPO_ROOT, 'scripts', 'lib', file), join(dir, 'scripts', 'lib', file))
  }
}

function makeRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'arbiter-2328-')))
  git(dir, ['init', '-q', '-b', BRANCH])
  git(dir, ['config', 'user.email', 'test@arbiter.dev'])
  git(dir, ['config', 'user.name', 'Arbiter Test'])
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n')
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fx', version: '1.0.0' }))
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3 }))
  writeFileSync(join(dir, '.nvmrc'), '22\n')
  writeFileSync(join(dir, 'README.md'), '# fixture\n')
  installGateEvidenceLib(dir)
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'init', '--no-gpg-sign'])
  return dir
}

/** A byte-identical sibling checkout: same sha, same branch, same content. */
function cloneRepo(src: string): string {
  const dst = realpathSync(mkdtempSync(join(tmpdir(), 'arbiter-2328-clone-')))
  rmSync(dst, { recursive: true, force: true })
  execFileSync('git', ['clone', '-q', src, dst], { stdio: 'ignore' })
  const real = realpathSync(dst)
  dirs.push(real)
  git(real, ['config', 'user.email', 'test@arbiter.dev'])
  git(real, ['config', 'user.name', 'Arbiter Test'])
  return real
}

/** Stamp REAL evidence for `stampedIn` into the `.arbiter/` of `writtenTo`. */
function stampEvidence(stampedIn: string, writtenTo: string = stampedIn): void {
  const marker = buildGateEvidence({
    root: stampedIn,
    level: 'L2',
    taskId: TASK_ID,
    start: captureGateStart(stampedIn),
  })
  expect(marker).not.toBeNull()
  mkdirSync(join(writtenTo, '.arbiter'), { recursive: true })
  writeFileSync(
    join(writtenTo, '.arbiter', 'gate-pass.json'),
    JSON.stringify(marker, null, 2) + '\n',
  )
}

// ── 1. arbiter task advance ────────────────────────────────────────────────
describe('#2328 consumer: arbiter task advance', () => {
  function seed(dir: string): void {
    writeTaskStateFile(dir, { phase: 'verification', tier: 'Standard', taskId: TASK_ID })
  }

  it('advances when the evidence was produced in THIS checkout', () => {
    const dir = track(makeRepo())
    seed(dir)
    stampEvidence(dir)
    expect(() => runTaskAdvance({ to: 'close', dir })).not.toThrow()
  })

  it('refuses evidence produced in a sibling checkout', () => {
    const a = track(makeRepo())
    const b = cloneRepo(a)
    seed(b)
    stampEvidence(a, b)
    expect(() => runTaskAdvance({ to: 'close', dir: b })).toThrow(/checkout_root/i)
  })

  it('refuses an old-schema (v1) marker instead of grandfathering it', () => {
    const dir = track(makeRepo())
    seed(dir)
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    writeFileSync(
      join(dir, '.arbiter', 'gate-pass.json'),
      JSON.stringify({
        head_sha: git(dir, ['rev-parse', 'HEAD']),
        branch: BRANCH,
        task_id: TASK_ID,
        timestamp: new Date().toISOString(),
        level: 'L2',
        node_version: process.version,
        git_user: 'Arbiter Test',
        tree_was_clean_at_run_time: true,
      }),
    )
    expect(() => runTaskAdvance({ to: 'close', dir })).toThrow(/schema|missing or empty/i)
  })

  it('refuses evidence older than the TTL', () => {
    const dir = track(makeRepo())
    seed(dir)
    stampEvidence(dir)
    const path = join(dir, '.arbiter', 'gate-pass.json')
    const marker = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    marker.timestamp = new Date(Date.now() - 500 * 60_000).toISOString()
    writeFileSync(path, JSON.stringify(marker))
    expect(() => runTaskAdvance({ to: 'close', dir })).toThrow(/expired|old/i)
  })
})

// ── 2. enforce-gate-before-pr.mjs ──────────────────────────────────────────
describe('#2328 consumer: enforce-gate-before-pr hook', () => {
  const HOOK = join(REPO_ROOT, '.claude', 'hooks', 'enforce-gate-before-pr.mjs')

  function runHook(dir: string) {
    return spawnSync('node', [HOOK], {
      cwd: dir,
      encoding: 'utf-8',
      input: JSON.stringify({ tool_input: { command: 'gh pr create --title "feat: x"' } }),
      env: { ...process.env, CLAUDE_TOOL_INPUT_COMMAND: 'gh pr create --title "feat: x"' },
    })
  }

  it('allows the PR when the evidence was produced in THIS checkout', () => {
    const dir = track(makeRepo())
    stampEvidence(dir)
    expect(runHook(dir).status).toBe(0)
  })

  it('blocks the PR when the evidence came from a sibling checkout', () => {
    const a = track(makeRepo())
    const b = cloneRepo(a)
    stampEvidence(a, b)
    const result = runHook(b)
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/checkout_root/i)
  })

  it('blocks the PR on an old-schema (v1) marker', () => {
    const dir = track(makeRepo())
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    writeFileSync(
      join(dir, '.arbiter', 'gate-pass.json'),
      JSON.stringify({
        head_sha: git(dir, ['rev-parse', 'HEAD']),
        branch: BRANCH,
        level: 'L2',
        task_id: TASK_ID,
        timestamp: new Date().toISOString(),
        node_version: process.version,
        tree_was_clean_at_run_time: true,
      }),
    )
    const result = runHook(dir)
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/schema|missing or empty/i)
  })
})

// ── 3. stop-evidence-guard.mjs ─────────────────────────────────────────────
describe('#2328 consumer: stop-evidence-guard hook', () => {
  const HOOK = join(REPO_ROOT, '.claude', 'hooks', 'stop-evidence-guard.mjs')
  const SANITIZED_ID = '_2328'

  function seedCorrelatedEvidence(dir: string): void {
    const sha = git(dir, ['rev-parse', 'HEAD'])
    writeTaskStateFile(dir, { phase: 'close', tier: 'Standard', taskId: TASK_ID })
    const prDir = join(dir, '.arbiter', 'evidence', 'plan-review', SANITIZED_ID)
    mkdirSync(prDir, { recursive: true })
    writeFileSync(
      join(prDir, 'latest.json'),
      JSON.stringify({ verdict: 'PASS', branch: BRANCH, sha, tier: 'Standard' }),
    )
    writeFileSync(
      join(dir, '.arbiter', 'agents-dispatched.json'),
      JSON.stringify({ count: 4, branch: BRANCH, sha }),
    )
  }

  function seedJourneyEvidence(dir: string): void {
    const sha = git(dir, ['rev-parse', 'HEAD'])
    const journeyDir = join(dir, '.arbiter', 'evidence', 'journey')
    mkdirSync(journeyDir, { recursive: true })
    writeFileSync(
      join(journeyDir, '_2328.json'),
      JSON.stringify({ branch: BRANCH, sha, spec: 'e2e/checkout.spec.ts', target: 'artifact' }),
    )
  }

  function transcript(): string {
    const p = join(track(realpathSync(mkdtempSync(join(tmpdir(), 'arbiter-2328-t-')))), 't.jsonl')
    writeFileSync(
      p,
      [
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: [{ type: 'text', text: 'finish it' }] },
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'task complete, ready to merge' }],
          },
        }),
      ].join('\n') + '\n',
    )
    return p
  }

  function runHook(dir: string) {
    return spawnSync('node', [HOOK], {
      cwd: dir,
      encoding: 'utf-8',
      input: JSON.stringify({ transcript_path: transcript(), stop_hook_active: false }),
    })
  }

  it('allows the completion claim when the evidence was produced in THIS checkout', () => {
    const dir = track(makeRepo())
    seedCorrelatedEvidence(dir)
    seedJourneyEvidence(dir)
    stampEvidence(dir)
    expect(runHook(dir).status).toBe(0)
  })

  it('blocks the completion claim when journey evidence is missing', () => {
    const dir = track(makeRepo())
    seedCorrelatedEvidence(dir)
    stampEvidence(dir)
    const result = runHook(dir)
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/journey/i)
  })

  it('blocks the completion claim when the evidence came from a sibling checkout', () => {
    const a = track(makeRepo())
    const b = cloneRepo(a)
    seedCorrelatedEvidence(b)
    stampEvidence(a, b)
    const result = runHook(b)
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/checkout_root/i)
  })

  it('blocks the completion claim on an old-schema (v1) marker', () => {
    const dir = track(makeRepo())
    seedCorrelatedEvidence(dir)
    writeFileSync(
      join(dir, '.arbiter', 'gate-pass.json'),
      JSON.stringify({
        head_sha: git(dir, ['rev-parse', 'HEAD']),
        branch: BRANCH,
        level: 'L2',
        task_id: TASK_ID,
        timestamp: new Date().toISOString(),
        tree_was_clean_at_run_time: true,
      }),
    )
    const result = runHook(dir)
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/schema|missing or empty/i)
  })
})

// ── 4. .githooks/pre-push reuse rule (#2085) ───────────────────────────────
describe('#2328 consumer: pre-push green-evidence reuse', () => {
  /**
   * The check-all stub FAILS and drops a sentinel, so the two outcomes are
   * unambiguous: reuse fired ⟺ exit 0 and no sentinel; no reuse ⟺ the stub ran.
   */
  function prepare(dir: string): void {
    mkdirSync(join(dir, 'node_modules'), { recursive: true })
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(
      join(dir, 'scripts', 'check-all.mjs'),
      "#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs'\nwriteFileSync('STUB_RAN', '1')\nprocess.exit(1)\n",
      { mode: 0o755 },
    )
    installGateEvidenceLib(dir)
    mkdirSync(join(dir, '.githooks'), { recursive: true })
    const dest = join(dir, '.githooks', 'pre-push')
    copyFileSync(join(REPO_ROOT, '.githooks', 'pre-push'), dest)
    chmodSync(dest, 0o755)
    git(dir, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
  }

  function runHook(dir: string) {
    const r = spawnSync('bash', [join(dir, '.githooks', 'pre-push'), 'origin', 'url'], {
      cwd: dir,
      encoding: 'utf-8',
      input: '',
      env: { ...process.env, ARBITER_PREPUSH_MAX_AGE_MIN: '240' },
    })
    return { ...r, stubRan: existsSync(join(dir, 'STUB_RAN')) }
  }

  it('reuses the evidence when it was produced in THIS checkout', () => {
    const dir = track(makeRepo())
    prepare(dir)
    stampEvidence(dir)
    const r = runHook(dir)
    expect(r.stubRan).toBe(false)
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/reusing green/i)
  })

  it('re-runs the gate when the evidence came from a sibling checkout', () => {
    const a = track(makeRepo())
    prepare(a)
    const b = cloneRepo(a)
    prepare(b)
    stampEvidence(a, b)
    const r = runHook(b)
    expect(r.stubRan).toBe(true)
    expect(r.status).not.toBe(0)
  })

  it('re-runs the gate on an old-schema (v1) marker', () => {
    const dir = track(makeRepo())
    prepare(dir)
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    writeFileSync(
      join(dir, '.arbiter', 'gate-pass.json'),
      JSON.stringify({
        head_sha: git(dir, ['rev-parse', 'HEAD']),
        branch: BRANCH,
        level: 'L2',
        task_id: TASK_ID,
        timestamp: new Date().toISOString(),
        node_version: process.version,
        tree_was_clean_at_run_time: true,
      }),
    )
    const r = runHook(dir)
    expect(r.stubRan).toBe(true)
    expect(r.status).not.toBe(0)
  })
})
