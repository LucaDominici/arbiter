// SPDX-License-Identifier: Apache-2.0
/**
 * Branch-coverage climb for src/review/dispatch.ts (#1486).
 *
 * Targets branches the established suites under __tests__/review do not reach:
 *   - the dispatcher-throws / cycleError path in dispatchPlanReview
 *   - case-insensitive + no-match verdict parsing via the public seam
 *   - submitPlanReview WARN/notes/reason branches and crossCheckManifest
 *     not-found + unreadable-JSON error paths
 *   - dispatchClaudeAgent success / parse-error / notFound / evidenceDir
 *     branches and its default cmd+timeout fallbacks (driven through real
 *     `node -e` subprocesses — deterministic, no `claude` CLI needed)
 *   - makeCodeReviewEvidenceDir
 *
 * Pure test-only: builds real temp fixture dirs, stubs the injectable
 * dispatcher seam, and uses real short-lived `node` subprocesses for the
 * non-injectable runCli path. No network, no git, no `claude`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  dispatchPlanReview,
  emitPlanReviewPrompts,
  submitPlanReview,
  SubmitValidationError,
  dispatchClaudeAgent,
  makeCodeReviewEvidenceDir,
  type SubagentResult,
  type SubagentDispatcher,
} from '../../src/review/dispatch.js'

const PLAN = `# Plan: coverage
## Scope
- src/review/dispatch.ts
## Test plan
- write failing tests first
`

interface TempEnv {
  dir: string
  cleanup: () => void
}

function withTempDir(): TempEnv {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-disp-cov-'))
  writeFileSync(join(dir, 'AGENTS.md'), '# Test AGENTS.md\n')
  return { dir, cleanup: (): void => rmSync(dir, { recursive: true, force: true }) }
}

/** Dispatcher that returns a fixed raw stdout line for every pass. */
function rawDispatcher(stdout: string): SubagentDispatcher {
  return { run: (): SubagentResult => ({ stdout, exitCode: 0 }) }
}

/** Dispatcher whose Nth `run` throws — drives the cycleError path. */
function throwingDispatcher(message: string): SubagentDispatcher {
  return {
    run: (): SubagentResult => {
      throw new Error(message)
    },
  }
}

/**
 * Run `fn` with `PATH` neutralised so a bare `claude` lookup is a deterministic
 * ENOENT. Lets tests exercise dispatchClaudeAgent's default `cmd='claude'`
 * branch without spawning a real `claude` (which would make a live print-mode
 * API call and hang on any host where the CLI is installed). PATH is always
 * restored, even if `fn` throws.
 */
async function withoutClaudeOnPath(fn: () => Promise<void>): Promise<void> {
  const savedPath = process.env.PATH
  process.env.PATH = ''
  try {
    await fn()
  } finally {
    if (savedPath === undefined) delete process.env.PATH
    else process.env.PATH = savedPath
  }
}

describe('dispatchPlanReview — dispatcher-throws (cycleError) path', () => {
  let env: TempEnv
  beforeEach(() => {
    env = withTempDir()
  })
  afterEach(() => {
    env.cleanup()
    delete process.env.ARBITER_PLAN_REVIEW_OPTIONAL
  })

  it('an Error thrown by the dispatcher → final FAIL, reason carries the message', () => {
    const result = dispatchPlanReview({
      planContent: PLAN,
      dir: env.dir,
      tier: 'XS',
      dispatcher: throwingDispatcher('boom-explosion'),
    })
    expect(result.verdict).toBe('FAIL')
    expect(result.exitCode).toBe(2)
    // #1577: a crash reason is prefixed so it is unmistakably a dispatcher
    // failure (not the claude-missing skip) and still carries the cause.
    expect(result.reason).toBe('plan-review dispatcher crashed: boom-explosion')
    // attempts increments before the throw; no completed invocations recorded.
    expect(result.attempts).toBe(1)
    expect(result.totalInvocations).toBe(0)
    const latest = JSON.parse(readFileSync(result.latestPath, 'utf-8')) as Record<string, unknown>
    expect(latest.reason).toBe('plan-review dispatcher crashed: boom-explosion')
    expect(latest.source).toBe('dispatch')
  })

  it('a non-Error thrown value → reason is String()-coerced', () => {
    const stringThrower: SubagentDispatcher = {
      run: (): SubagentResult => {
        throw 'plain-string-failure'
      },
    }
    const result = dispatchPlanReview({
      planContent: PLAN,
      dir: env.dir,
      tier: 'XS',
      dispatcher: stringThrower,
    })
    expect(result.verdict).toBe('FAIL')
    expect(result.reason).toBe('plan-review dispatcher crashed: plain-string-failure')
  })

  it('dispatcher-unavailable with ARBITER_PLAN_REVIEW_OPTIONAL unset → FAIL with claude-required reason', () => {
    // #1577: claude-missing is signalled by the dispatcherUnavailable transport
    // flag, not a `verdict: ERROR` stdout token a model could forge.
    const unavailableDispatcher: SubagentDispatcher = {
      run: (): SubagentResult => ({ stdout: '', exitCode: 127, dispatcherUnavailable: true }),
    }
    const result = dispatchPlanReview({
      planContent: PLAN,
      dir: env.dir,
      tier: 'XS',
      dispatcher: unavailableDispatcher,
    })
    expect(result.verdict).toBe('FAIL')
    expect(result.reason).toMatch(/claude CLI required/i)
  })
})

describe('dispatchPlanReview — verdict parsing branches', () => {
  let env: TempEnv
  beforeEach(() => {
    env = withTempDir()
  })
  afterEach(() => env.cleanup())

  it('no "verdict:" token in stdout → parsed as FAIL', () => {
    const result = dispatchPlanReview({
      planContent: PLAN,
      dir: env.dir,
      tier: 'XS',
      dispatcher: rawDispatcher('the reviewer produced only prose, no token\n'),
    })
    expect(result.verdict).toBe('FAIL')
    expect(result.exitCode).toBe(2)
  })

  it('lowercase "verdict: pass" is matched case-insensitively → PASS', () => {
    const result = dispatchPlanReview({
      planContent: PLAN,
      dir: env.dir,
      tier: 'XS',
      dispatcher: rawDispatcher('verdict: pass — looks good\n'),
    })
    expect(result.verdict).toBe('PASS')
    expect(result.exitCode).toBe(0)
  })

  it('WARN that settles to PASS on the second revise cycle (attempts=2)', () => {
    const seq = ['verdict: WARN\n', 'verdict: PASS\n']
    let i = 0
    const d: SubagentDispatcher = {
      run: (): SubagentResult => {
        const stdout = seq[i] ?? seq[seq.length - 1] ?? 'verdict: PASS\n'
        i++
        return { stdout, exitCode: 0 }
      },
    }
    const result = dispatchPlanReview({ planContent: PLAN, dir: env.dir, tier: 'XS', dispatcher: d })
    expect(result.verdict).toBe('PASS')
    expect(result.attempts).toBe(2)
  })
})

describe('submitPlanReview — WARN / notes / reason branches', () => {
  let env: TempEnv
  beforeEach(() => {
    env = withTempDir()
  })
  afterEach(() => env.cleanup())

  it('a WARN pass at attempts=1 finalises to WARN (exit 1) and writes per-pass notes', () => {
    const res = submitPlanReview({
      dir: env.dir,
      tier: 'XS',
      planContent: PLAN,
      reviewer: 'agent-x',
      taskId: 'warn-case',
      passes: [{ pass: 1, verdict: 'WARN', notes: 'fixable gap in scope' }],
    })
    expect(res.verdict).toBe('WARN')
    expect(res.exitCode).toBe(1)
    // WARN at attempts=1 has no synthesised reason.
    expect(res.reason).toBeUndefined()
    const passFile = readdirSync(res.runDir).find((f) => f === 'pass-1.json')
    expect(passFile).toBeDefined()
    const pass = JSON.parse(readFileSync(join(res.runDir, 'pass-1.json'), 'utf-8')) as Record<
      string,
      unknown
    >
    expect(pass.notes).toBe('fixable gap in scope')
    expect(pass.source).toBe('submit')
    expect(pass.reviewer).toBe('agent-x')
  })

  it('a pass without notes omits the notes key in the persisted record', () => {
    const res = submitPlanReview({
      dir: env.dir,
      tier: 'XS',
      planContent: PLAN,
      reviewer: 'agent-y',
      taskId: 'no-notes',
      passes: [{ pass: 1, verdict: 'PASS' }],
    })
    const pass = JSON.parse(readFileSync(join(res.runDir, 'pass-1.json'), 'utf-8')) as Record<
      string,
      unknown
    >
    expect('notes' in pass).toBe(false)
  })

  it('passes are sorted by index before persisting (out-of-order input)', () => {
    const res = submitPlanReview({
      dir: env.dir,
      tier: 'S',
      planContent: PLAN,
      reviewer: 'r',
      taskId: 'sort-case',
      passes: [
        { pass: 3, verdict: 'PASS' },
        { pass: 1, verdict: 'PASS' },
        { pass: 2, verdict: 'PASS' },
      ],
    })
    expect(res.verdict).toBe('PASS')
    const files = readdirSync(res.runDir)
      .filter((f) => f.startsWith('pass-'))
      .sort()
    expect(files).toEqual(['pass-1.json', 'pass-2.json', 'pass-3.json'])
  })

  it('a FAIL pass omits a reason (FAIL has no synthesised reason) but writes latest.json', () => {
    const res = submitPlanReview({
      dir: env.dir,
      tier: 'XS',
      planContent: PLAN,
      reviewer: 'r',
      taskId: 'fail-case',
      passes: [{ pass: 1, verdict: 'FAIL' }],
    })
    expect(res.verdict).toBe('FAIL')
    expect(res.reason).toBeUndefined()
    expect(existsSync(res.latestPath)).toBe(true)
  })
})

describe('submitPlanReview — crossCheckManifest error paths', () => {
  let env: TempEnv
  beforeEach(() => {
    env = withTempDir()
  })
  afterEach(() => env.cleanup())

  it('missing manifest file → SubmitValidationError (not found)', () => {
    const missing = join(env.dir, 'does-not-exist', 'manifest.json')
    expect(() =>
      submitPlanReview({
        dir: env.dir,
        tier: 'XS',
        planContent: PLAN,
        reviewer: 'r',
        taskId: 'm-missing',
        passes: [{ pass: 1, verdict: 'PASS' }],
        manifestPath: missing,
      }),
    ).toThrow(/emit manifest not found/)
  })

  it('unreadable (malformed JSON) manifest → SubmitValidationError (unreadable)', () => {
    const badManifest = join(env.dir, 'manifest.json')
    writeFileSync(badManifest, '{ this is : not valid json', 'utf-8')
    expect(() =>
      submitPlanReview({
        dir: env.dir,
        tier: 'XS',
        planContent: PLAN,
        reviewer: 'r',
        taskId: 'm-bad',
        passes: [{ pass: 1, verdict: 'PASS' }],
        manifestPath: badManifest,
      }),
    ).toThrow(SubmitValidationError)
  })

  it('a matching manifest with no taskId on submit falls back to "unknown"', () => {
    const emitDir = join(env.dir, 'emit')
    const emit = emitPlanReviewPrompts({
      planContent: PLAN,
      dir: env.dir,
      tier: 'XS',
      emitDir,
      // no taskId → emit writes under "unknown"
    })
    const res = submitPlanReview({
      dir: env.dir,
      tier: 'XS',
      planContent: PLAN,
      reviewer: 'r',
      passes: [{ pass: 1, verdict: 'PASS' }],
      manifestPath: emit.manifestPath,
    })
    expect(res.verdict).toBe('PASS')
    expect(res.evidenceDir).toMatch(/\/unknown$/)
  })
})

describe('emitPlanReviewPrompts — taskId fallback branch', () => {
  let env: TempEnv
  beforeEach(() => {
    env = withTempDir()
  })
  afterEach(() => env.cleanup())

  it('empty-string taskId folds to "unknown" in the manifest', () => {
    const emitDir = join(env.dir, 'emit')
    const res = emitPlanReviewPrompts({
      planContent: PLAN,
      dir: env.dir,
      tier: 'XS',
      emitDir,
      taskId: '',
    })
    const manifest = JSON.parse(readFileSync(res.manifestPath, 'utf-8')) as { taskId: string }
    expect(manifest.taskId).toBe('unknown')
  })
})

describe('dispatchClaudeAgent — runCli-backed branches (real node subprocess)', () => {
  let env: TempEnv
  beforeEach(() => {
    env = withTempDir()
  })
  afterEach(() => env.cleanup())

  it('a clean JSON envelope → AgentResult with parsed findings (no evidenceDir)', async () => {
    // dispatchClaudeAgent always passes ['-p', prompt]; node treats '-p <expr>'
    // as "evaluate and print", so the prompt IS a JS expression. We use
    // JSON.stringify(...) so node prints valid JSON that parseAgentReport reads.
    const dispatch = dispatchClaudeAgent({ cmd: 'node' })
    const result = await dispatch(
      `JSON.stringify({findings:[{severity:"warning",agent:"bugs",message:"x"}],passed:false})`,
      'bugs',
    )
    expect(result.agent).toBe('bugs')
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.severity).toBe('warning')
    expect(result.passed).toBe(false)
  })

  it('persists agent-<name>.json when evidenceDir is set (success path)', async () => {
    const evidenceDir = join(env.dir, 'cr-evidence')
    const dispatch = dispatchClaudeAgent({ cmd: 'node', evidenceDir })
    const result = await dispatch(`JSON.stringify({findings:[],passed:true})`, 'type-safety')
    expect(result.passed).toBe(true)
    const persisted = join(evidenceDir, 'agent-type-safety.json')
    expect(existsSync(persisted)).toBe(true)
    const parsed = JSON.parse(readFileSync(persisted, 'utf-8')) as Record<string, unknown>
    expect(parsed.agent).toBe('type-safety')
    expect(parsed.passed).toBe(true)
  })

  it('a non-JSON / malformed agent payload → blocker finding (parse error surfaced)', async () => {
    // node -p of a string expression prints the string itself (no JSON object).
    const dispatch = dispatchClaudeAgent({ cmd: 'node' })
    const result = await dispatch(`"this is not a json object at all"`, 'bugs')
    expect(result.passed).toBe(false)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.severity).toBe('blocker')
    expect(result.findings[0]?.agent).toBe('bugs')
  })

  it('persists a failure blocker to evidenceDir when parse fails', async () => {
    const evidenceDir = join(env.dir, 'cr-fail-evidence')
    const dispatch = dispatchClaudeAgent({ cmd: 'node', evidenceDir })
    const result = await dispatch(`"plain text, not an object"`, 'silent-failure-hunter')
    expect(result.passed).toBe(false)
    const persisted = join(evidenceDir, 'agent-silent-failure-hunter.json')
    expect(existsSync(persisted)).toBe(true)
    const parsed = JSON.parse(readFileSync(persisted, 'utf-8')) as {
      passed: boolean
      findings: Array<{ severity: string }>
    }
    expect(parsed.passed).toBe(false)
    expect(parsed.findings[0]?.severity).toBe('blocker')
  })

  it('a non-existent cmd → notFound CliError mapped to a blocker finding (failed)', async () => {
    const dispatch = dispatchClaudeAgent({
      cmd: 'arbiter-nonexistent-binary-xyz',
      timeoutMs: 5_000,
    })
    const result = await dispatch('any prompt', 'bugs')
    expect(result.passed).toBe(false)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.severity).toBe('blocker')
    expect(result.findings[0]?.message).toMatch(/bugs/)
    // notFound is NOT a timeout, so the message takes the "failed:" branch.
    expect(result.findings[0]?.message).toMatch(/failed:/)
  })

  it('default options (no cmd/timeout) resolve to the claude binary and a blocker on absence', async () => {
    // Exercises the `opts.cmd ?? 'claude'` + default-timeout fallbacks WITHOUT
    // spawning a real `claude`: an installed CLI (dev box / runner) would make
    // this fire a live print-mode subprocess and hang to the test timeout.
    // Neutralising PATH makes the bare `claude` lookup a deterministic ENOENT
    // (notFound → blocker) regardless of host environment.
    await withoutClaudeOnPath(async () => {
      const dispatch = dispatchClaudeAgent()
      const result = await dispatch('prompt', 'domain-consistency')
      expect(result.agent).toBe('domain-consistency')
      expect(result.passed).toBe(false)
      expect(result.findings[0]?.severity).toBe('blocker')
    })
  })

  it('options object is optional — dispatchClaudeAgent() with no args is callable', async () => {
    // Same default cmd='claude' path — keep it off the real binary (see above).
    await withoutClaudeOnPath(async () => {
      const dispatch = dispatchClaudeAgent({})
      const result = await dispatch('p', 'test-analyzer')
      expect(result.agent).toBe('test-analyzer')
    })
  })
})

describe('makeCodeReviewEvidenceDir', () => {
  let env: TempEnv
  beforeEach(() => {
    env = withTempDir()
  })
  afterEach(() => env.cleanup())

  it('creates a timestamped review dir under <dir>/.evidence and returns its path', () => {
    const path = makeCodeReviewEvidenceDir(env.dir)
    expect(existsSync(path)).toBe(true)
    expect(path).toMatch(/\.evidence\/review-/)
    expect(path.startsWith(env.dir)).toBe(true)
  })
})
