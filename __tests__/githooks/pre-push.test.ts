/**
 * Pre-push evidence-freshness gate behavioural tests (Port #4).
 *
 * The host `.githooks/pre-push` script runs many checks (node_modules, .nvmrc,
 * clean working tree, evidence freshness, rsync workaround, then `check-all`).
 * To exercise the freshness gate in isolation we:
 *   1. Copy the real script into a temp git repo.
 *   2. Provide a stub `scripts/check-all.mjs` that exits 0 (so the hook can
 *      reach completion when the freshness gate passes).
 *   3. Provide an empty `node_modules/` and no `.nvmrc` so those early gates
 *      are inert.
 *   4. Vary the .arbiter/evidence mtime and env vars to assert behaviour.
 *
 * The same script is shipped to consumers, so a behavioural test is the only
 * reliable invariant — string assertions on the bash source would silently
 * pass on subtle bugs (operator precedence, exit handling under `set -e`).
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  utimesSync,
  readFileSync,
  existsSync,
  copyFileSync,
  chmodSync,
} from 'node:fs'
import { spawnSync, execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const REPO_ROOT = resolve(__dirname, '..', '..')
const HOOK_SRC = join(REPO_ROOT, '.githooks', 'pre-push')

interface RunResult {
  status: number
  stdout: string
  stderr: string
}

interface SetupOpts {
  ageMin?: number | 'missing' | 'empty'
  /** Override the stub classifier output (defaults to high-risk so the gate hard-fails). */
  classifier?: { docs_only?: boolean; backend_changed?: boolean; high_risk?: boolean }
}

function classifierStub(c: SetupOpts['classifier'] = {}): string {
  const docs = c.docs_only ?? false
  const backend = c.backend_changed ?? true
  const risk = c.high_risk ?? true
  return `#!/usr/bin/env node
process.stdout.write("  classify: docs_only=${docs}\\n");
process.stdout.write("  classify: backend_changed=${backend}\\n");
process.stdout.write("  classify: high_risk=${risk}\\n");
process.exit(0);
`
}

function setupRepo(opts: SetupOpts = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-prepush-'))
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@arbiter.dev'], {
    cwd: dir,
    stdio: 'ignore',
  })
  execFileSync('git', ['config', 'user.name', 'Arbiter Test'], { cwd: dir, stdio: 'ignore' })

  // Stub node_modules so the early bail-out is not triggered.
  mkdirSync(join(dir, 'node_modules'), { recursive: true })

  // Stub check-all so the post-freshness gate succeeds.
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  writeFileSync(join(dir, 'scripts', 'check-all.mjs'), '#!/usr/bin/env node\nprocess.exit(0)\n', {
    mode: 0o755,
  })

  // Per-test classifier stub (committed so the hook's porcelain check stays clean).
  writeFileSync(join(dir, 'scripts', 'ci-classify-changes.mjs'), classifierStub(opts.classifier), {
    mode: 0o755,
  })

  // Copy the real hook into place (also committed → working tree clean).
  const hookDest = join(dir, '.githooks', 'pre-push')
  mkdirSync(join(dir, '.githooks'), { recursive: true })
  copyFileSync(HOOK_SRC, hookDest)
  chmodSync(hookDest, 0o755)

  // Evidence dir prepared BEFORE the initial commit so the working tree stays
  // clean (the freshness check looks at mtime, not git state).
  const evidenceDir = join(dir, '.arbiter', 'evidence')
  if (opts.ageMin === 'missing') {
    // do nothing
  } else if (opts.ageMin === 'empty') {
    mkdirSync(evidenceDir, { recursive: true })
  } else if (typeof opts.ageMin === 'number') {
    mkdirSync(evidenceDir, { recursive: true })
    const f = join(evidenceDir, 'foo.txt')
    writeFileSync(f, 'evidence')
    const past = new Date(Date.now() - opts.ageMin * 60 * 1000)
    utimesSync(f, past, past)
  }

  // Single commit captures everything; working tree porcelain check stays green.
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], {
    cwd: dir,
    stdio: 'ignore',
  })

  // Re-apply mtime after commit — git may have stat'd the file.
  if (typeof opts.ageMin === 'number') {
    const f = join(evidenceDir, 'foo.txt')
    const past = new Date(Date.now() - opts.ageMin * 60 * 1000)
    utimesSync(f, past, past)
  }

  return dir
}

function runHook(dir: string, env: Record<string, string> = {}): RunResult {
  const result = spawnSync('/usr/bin/bash', ['.githooks/pre-push'], {
    cwd: dir,
    encoding: 'utf-8',
    env: {
      // Minimal env. Inherit PATH so node + git resolve.
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: process.env.HOME ?? '/tmp',
      ...env,
    },
  })
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

describe('.githooks/pre-push — evidence freshness gate', () => {
  let dir: string

  afterEach(() => {
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  })

  it('fresh evidence (30 min) → gate passes', () => {
    dir = setupRepo({ ageMin: 30 })
    const r = runHook(dir)
    expect(r.status).toBe(0)
    expect(r.stderr).not.toMatch(/Error: \.arbiter\/evidence/)
  })

  it('stale evidence (300 min, default budget 240) → gate fails with non-zero exit', () => {
    dir = setupRepo({ ageMin: 300 })
    const r = runHook(dir)
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('Error:')
    expect(r.stderr).toMatch(/\.arbiter\/evidence\/ is \d+ min old/)
  })

  it('stale evidence + ARBITER_PREPUSH_BYPASS=true → gate passes with loud log + JSONL', () => {
    dir = setupRepo({ ageMin: 300 })
    const r = runHook(dir, {
      ARBITER_PREPUSH_BYPASS: 'true',
      ARBITER_PREPUSH_BYPASS_REASON: 'urgent hotfix',
    })
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('arbiter-bypass env=ARBITER_PREPUSH_BYPASS')
    expect(r.stderr).toContain('reason="urgent hotfix"')

    const jsonlPath = join(dir, '.arbiter', 'evidence', 'bypass-log.jsonl')
    expect(existsSync(jsonlPath)).toBe(true)
    const lines = readFileSync(jsonlPath, 'utf-8').trim().split('\n').filter(Boolean)
    expect(lines).toHaveLength(1)
    const entry = JSON.parse(lines[0])
    // Aligned with Port #10 (scripts/lib/loud-bypass.mjs) JSONL shape:
    // { env, branch, ts, value, bypassed, reason } + arbiter-prepush extras.
    expect(entry).toMatchObject({
      env: 'ARBITER_PREPUSH_BYPASS',
      value: 'true',
      bypassed: true,
      reason: 'urgent hotfix',
    })
    expect(typeof entry.branch).toBe('string')
    expect(typeof entry.ts).toBe('string')
    expect(typeof entry.age_min).toBe('number')
    expect(entry.age_min).toBeGreaterThanOrEqual(299)
    expect(entry.budget_min).toBe(240)
  })

  it('stale evidence + ambiguous ARBITER_PREPUSH_BYPASS=yes → warning emitted + gate still fails', () => {
    dir = setupRepo({ ageMin: 300 })
    const r = runHook(dir, { ARBITER_PREPUSH_BYPASS: 'yes' })
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain("ARBITER_PREPUSH_BYPASS='yes' is ambiguous")
    // Hard-fail message still emitted because the classifier stub reports high-risk.
    expect(r.stderr).toMatch(/\.arbiter\/evidence\/ is \d+ min old/)
  })

  it('missing .arbiter/evidence/ → gate skipped (passes)', () => {
    dir = setupRepo({ ageMin: 'missing' })
    const r = runHook(dir)
    expect(r.status).toBe(0)
    expect(r.stderr).not.toMatch(/\.arbiter\/evidence\/ is/)
  })

  it('empty .arbiter/evidence/ directory → gate skipped (passes)', () => {
    dir = setupRepo({ ageMin: 'empty' })
    const r = runHook(dir)
    expect(r.status).toBe(0)
    expect(r.stderr).not.toMatch(/\.arbiter\/evidence\/ is/)
  })

  it('stale evidence + low-risk classifier (docs_only=true) → warn-only, gate passes', () => {
    dir = setupRepo({
      ageMin: 300,
      classifier: { docs_only: true, backend_changed: false, high_risk: false },
    })
    const r = runHook(dir)
    expect(r.status).toBe(0)
    expect(r.stderr).toMatch(/Warning:.*Low-risk change set/)
  })

  it('bypass-log.jsonl is excluded from the freshness scan (no self-reset)', () => {
    dir = setupRepo({ ageMin: 300 })
    // Pre-seed a fresh bypass-log.jsonl; the freshness scan must IGNORE it.
    const jsonlPath = join(dir, '.arbiter', 'evidence', 'bypass-log.jsonl')
    writeFileSync(jsonlPath, '{"env":"prior-bypass"}\n')
    // No env → no bypass → gate sees only foo.txt (300 min old) → hard-fail.
    const r = runHook(dir)
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/\.arbiter\/evidence\/ is \d+ min old/)
  })

  it('ARBITER_PREPUSH_SKIP=true → freshness gate entirely skipped even when stale', () => {
    dir = setupRepo({ ageMin: 300 })
    const r = runHook(dir, { ARBITER_PREPUSH_SKIP: 'true' })
    expect(r.status).toBe(0)
    expect(r.stderr).not.toMatch(/\.arbiter\/evidence\/ is/)
  })
})
