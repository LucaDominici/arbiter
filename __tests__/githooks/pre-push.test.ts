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

  // #2427: the hook now launches the gate THROUGH the per-repo mutex wrapper, so
  // the real helper (and the run-helpers module it imports) must be on disk —
  // this fixture exercises the shipped hook verbatim, stubbing only the gate.
  mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true })
  for (const lib of ['gate-mutex.mjs', 'run-helpers.mjs']) {
    copyFileSync(join(REPO_ROOT, 'scripts', 'lib', lib), join(dir, 'scripts', 'lib', lib))
  }

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

/** #2102 — write `.claude/.task/status.json` and commit it (keeps the porcelain check green). */
function writeChainStatus(dir: string, state: Record<string, unknown>): void {
  const statusDir = join(dir, '.claude', '.task')
  mkdirSync(statusDir, { recursive: true })
  writeFileSync(join(statusDir, 'status.json'), JSON.stringify(state))
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['commit', '-q', '-m', 'chain: seed task state'], {
    cwd: dir,
    stdio: 'ignore',
  })
}

/** #2102 — add a commit AHEAD of `origin/main` (i.e. inside the push range) with the given subject. */
function commitAheadOfOrigin(dir: string, subject: string): void {
  writeFileSync(join(dir, `work-${Date.now()}-${Math.random()}.txt`), 'x')
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['commit', '-q', '-m', subject], { cwd: dir, stdio: 'ignore' })
}

/**
 * #2334 — point the current branch at `refs/remotes/origin/task-branch` via config.
 * `git branch --set-upstream-to` needs a configured remote, which these fixtures do not
 * have (they synthesise remote refs with `update-ref`), so set the two keys directly.
 */
function setUpstream(dir: string): void {
  const branch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
    cwd: dir,
    encoding: 'utf-8',
  }).trim()
  // `@{u}` only resolves when git can map refs/heads/* onto refs/remotes/origin/*, which
  // needs a remote with a fetch refspec — not just the two branch.* keys.
  execFileSync('git', ['config', 'remote.origin.url', '/dev/null'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'], {
    cwd: dir,
    stdio: 'ignore',
  })
  execFileSync('git', ['config', `branch.${branch}.remote`, 'origin'], {
    cwd: dir,
    stdio: 'ignore',
  })
  execFileSync('git', ['config', `branch.${branch}.merge`, 'refs/heads/task-branch'], {
    cwd: dir,
    stdio: 'ignore',
  })
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

/**
 * Chain-batching enforcement (#2102) — the pre-push chokepoint the whole issue is about.
 * Fresh evidence (ageMin: 30) on every setupRepo() call so the freshness gate never
 * interferes; these tests isolate the NEW chain-batching block.
 */
describe('.githooks/pre-push — chain-batching gate (#2102)', () => {
  let dir: string

  afterEach(() => {
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  })

  it('no .claude/.task/status.json at all → no-op, hook passes', () => {
    dir = setupRepo({ ageMin: 30 })
    const r = runHook(dir)
    expect(r.status).toBe(0)
    expect(r.stderr).not.toMatch(/chain batching/i)
  })

  it('status.json present but chainIds absent → no-op, hook passes', () => {
    dir = setupRepo({ ageMin: 30 })
    writeChainStatus(dir, { taskId: '#2102', phase: 'close' })
    const r = runHook(dir)
    expect(r.status).toBe(0)
    expect(r.stderr).not.toMatch(/chain batching/i)
  })

  it('status.json present but chainIds is an empty array → no-op, hook passes (byte-identical silence)', () => {
    dir = setupRepo({ ageMin: 30 })
    writeChainStatus(dir, { taskId: '#2102', chainIds: [], phase: 'close' })
    const r = runHook(dir)
    expect(r.status).toBe(0)
    expect(r.stderr).not.toMatch(/chain batching/i)
  })

  it('malformed status.json → fails OPEN (no-op), hook still passes', () => {
    dir = setupRepo({ ageMin: 30 })
    mkdirSync(join(dir, '.claude', '.task'), { recursive: true })
    writeFileSync(join(dir, '.claude', '.task', 'status.json'), '{ not valid json')
    execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' })
    execFileSync('git', ['commit', '-q', '-m', 'malformed status'], { cwd: dir, stdio: 'ignore' })
    const r = runHook(dir)
    expect(r.status).toBe(0)
  })

  it('chain declared, every id in [taskId, ...chainIds] referenced by a commit → hook passes', () => {
    dir = setupRepo({ ageMin: 30 })
    writeChainStatus(dir, { taskId: '#2102', chainIds: ['#2103'], phase: 'close' })
    commitAheadOfOrigin(dir, 'feat: first issue in chain #2102')
    commitAheadOfOrigin(dir, 'feat: second issue in chain #2103')
    const r = runHook(dir)
    expect(r.status).toBe(0)
    expect(r.stderr).not.toMatch(/chain batching/i)
  })

  it('chain declared, one chain id has NO commit in the push range → hook fails, names it', () => {
    dir = setupRepo({ ageMin: 30 })
    writeChainStatus(dir, { taskId: '#2102', chainIds: ['#2103'], phase: 'close' })
    // Only the primary id gets a commit — #2103 is never referenced.
    commitAheadOfOrigin(dir, 'feat: first issue in chain #2102')
    const r = runHook(dir)
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/chain batching/i)
    expect(r.stderr).toContain('#2103')
  })

  /**
   * #2334 — the gate prefers `@{u}..HEAD` when an upstream exists and only falls back to
   * `origin/main..HEAD` otherwise. Every test above runs without an upstream, so the
   * `@{u}` branch was never exercised — and it is the branch every REAL push after the
   * first one takes. On a follow-up push the range holds only the new commits, so the
   * gate demands each chain id be named again in that increment, which is impossible.
   *
   * The gate's purpose is traceability of the ids on the BRANCH, not in one increment.
   */
  it('a follow-up push to an already-pushed chain branch still passes (#2334)', () => {
    dir = setupRepo({ ageMin: 30 })
    writeChainStatus(dir, { taskId: '#2102', chainIds: ['#2103'], phase: 'close' })
    commitAheadOfOrigin(dir, 'feat: first issue in chain #2102')
    commitAheadOfOrigin(dir, 'feat: second issue in chain #2103')

    // Simulate the first push having landed: a tracking branch at the current HEAD.
    execFileSync('git', ['update-ref', 'refs/remotes/origin/task-branch', 'HEAD'], {
      cwd: dir,
      stdio: 'ignore',
    })
    setUpstream(dir)

    // A follow-up commit naming only the primary — e.g. a review fix.
    commitAheadOfOrigin(dir, 'fix: review follow-up #2102')

    const r = runHook(dir)
    expect(r.stderr).not.toMatch(/chain batching/i)
    expect(r.status).toBe(0)
  })

  it('a follow-up push still FAILS when a chain id is nowhere on the branch (#2334)', () => {
    // Guard: widening the range must not turn the gate off.
    dir = setupRepo({ ageMin: 30 })
    writeChainStatus(dir, { taskId: '#2102', chainIds: ['#2103'], phase: 'close' })
    commitAheadOfOrigin(dir, 'feat: first issue in chain #2102')
    execFileSync('git', ['update-ref', 'refs/remotes/origin/task-branch', 'HEAD'], {
      cwd: dir,
      stdio: 'ignore',
    })
    setUpstream(dir)
    commitAheadOfOrigin(dir, 'fix: review follow-up #2102')

    const r = runHook(dir)
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/chain batching/i)
    expect(r.stderr).toContain('#2103')
  })

  it('the primary taskId itself is enforced too — missing even without any chainIds gap', () => {
    dir = setupRepo({ ageMin: 30 })
    writeChainStatus(dir, { taskId: '#2102', chainIds: ['#2103'], phase: 'close' })
    // Only #2103 gets a commit — the PRIMARY id #2102 is never referenced.
    commitAheadOfOrigin(dir, 'feat: second issue in chain #2103')
    const r = runHook(dir)
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('#2102')
  })

  it('word boundary: a commit mentioning #21 does NOT satisfy a declared #2103', () => {
    dir = setupRepo({ ageMin: 30 })
    writeChainStatus(dir, { taskId: '#2102', chainIds: ['#2103'], phase: 'close' })
    commitAheadOfOrigin(dir, 'feat: first issue in chain #2102')
    // Deliberately references a DIFFERENT, shorter id sharing #2103's prefix.
    commitAheadOfOrigin(dir, 'feat: unrelated partial work #21')
    const r = runHook(dir)
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('#2103')
  })

  it('taskId stored WITHOUT a leading # (raw `task init --id` form) is still matched', () => {
    dir = setupRepo({ ageMin: 30 })
    // Mirrors what `arbiter task init --id 2102` persists verbatim (no # normalization there).
    writeChainStatus(dir, { taskId: '2102', chainIds: ['#2103'], phase: 'close' })
    commitAheadOfOrigin(dir, 'feat: first issue in chain #2102')
    commitAheadOfOrigin(dir, 'feat: second issue in chain #2103')
    const r = runHook(dir)
    expect(r.status).toBe(0)
  })

  it('no chainIds declared → the hook output is byte-identical to the pre-chain hook (no-op)', () => {
    dir = setupRepo({ ageMin: 30 })
    const before = runHook(dir)
    expect(before.status).toBe(0)
    writeChainStatus(dir, { taskId: '#2102', phase: 'close' })
    const after = runHook(dir)
    expect(after.status).toBe(0)
    expect(after.stdout + after.stderr).toBe(before.stdout + before.stderr)
  })
})
