// SPDX-License-Identifier: Apache-2.0
import { dirname, resolve } from 'node:path'
import { runCli } from '../utils/run-cli.js'
import { extractFailureSignature, writeTddEvidence, type TddEvidence } from '../evidence/tdd.js'
import {
  blobShaInCommit,
  currentBranch,
  hasDirtyTestPaths,
  pathExistsInCommit,
} from '../evidence/git-checks.js'
import { normalizeChainId, readTaskId, readUnifiedState } from './task-state.js'
import { loadConfig } from '../utils/config.js'
import { detectLanguage } from '../detectors/language.js'
import type { Language } from '../wizard/types.js'

export interface RecordRedOptions {
  testPath: string
  dir?: string
  /** Task to record for; required to select a secondary issue on a declared train. */
  taskId?: string
  /** Explicit test command (binary + args); overrides runner auto-selection. */
  testCmd?: readonly string[]
  /** Test-run timeout in ms. Default 60_000; clamped to [1000, 600_000]. */
  timeoutMs?: number
  /**
   * Skip the dirty-`__tests__` and test-path-in-HEAD refusals (#1988). Only
   * for exotic flows (e.g. re-recording evidence at a detached-worktree SHA);
   * the default (false) is the safe path that keeps evidence pointing at a
   * commit that actually contains the RED test.
   */
  force?: boolean
}

export interface RecordRedSuccess {
  ok: true
  evidencePath: string
  framework: string
}

export interface RecordRedFailure {
  ok: false
  reason: string
}

/** Default per-run timeout (ms). Matches the historical fixed value. */
export const DEFAULT_RECORD_RED_TIMEOUT_MS = 60_000

/** Hard ceiling for the test-run timeout (ms) — a RED phase that takes longer
 * than 10 minutes is almost certainly an integration run, not a unit RED, and
 * should be scoped explicitly by the user. */
export const MAX_RECORD_RED_TIMEOUT_MS = 600_000

function clampTimeout(ms: number | undefined): number {
  if (ms === undefined) return DEFAULT_RECORD_RED_TIMEOUT_MS
  if (!Number.isFinite(ms) || ms < 1000) return 1000
  if (ms > MAX_RECORD_RED_TIMEOUT_MS) return MAX_RECORD_RED_TIMEOUT_MS
  return Math.floor(ms)
}

/** Replace the recording worktree prefix with a portable repository-relative path (#2174). */
function repositoryRelativeLog(log: string, dir: string): string {
  const root = resolve(dir)
  const roots = [root, root.replaceAll('\\', '/')]
  return roots.reduce(
    (relative, prefix) =>
      relative.replaceAll(`${prefix}/`, '').replaceAll(`${prefix}\\`, '').replaceAll(prefix, '.'),
    log,
  )
}

function toGoPackageDir(dir: string): string {
  if (dir === '' || dir === '.') return '.'
  if (dir.startsWith('./') || dir.startsWith('/') || dir.startsWith('../')) return dir
  return `./${dir}`
}

function resolveLanguage(dir: string): Language {
  const stored = loadConfig(dir)
  if (stored?.language) return stored.language
  return detectLanguage(dir)
}

/**
 * Select the test runner for a single failing test from project language.
 * The test path is repo-relative. Package/dir scoping is best-effort: the
 * user can override the exact command with `--test-command` for precise runs.
 */
function selectRunner(language: Language, testPath: string): readonly string[] {
  switch (language) {
    case 'go':
      // `go test` takes a package path, not a file. Scope to the file's
      // package dir (the test path's dirname) so only that package runs.
      // Relative dirs need the `./` prefix or `go test` treats them as an
      // import path and fails with "package not found" rather than a test run.
      return ['go', 'test', toGoPackageDir(dirname(testPath))]
    case 'python':
      // pytest accepts a file path (and a `::node` suffix) directly.
      return ['pytest', testPath]
    case 'typescript':
    case 'java':
    case 'kotlin':
    case 'rust':
    case 'multi':
    case 'unknown':
    default:
      // Default to the TS/Vitest command (the historical behaviour) for any
      // JS/TS project and any language without a bespoke mapping.
      return ['npx', 'vitest', 'run', testPath]
  }
}

interface CapturedTestOutput {
  log: string
  exitCode: number
}

interface CliOutputError {
  stdout: string
  stderr: string
  exitCode?: number
  timedOut?: boolean
  notFound?: boolean
}

function combineTestOutput(stdout: string, stderr: string): string {
  return stdout + (stderr ? `\n${stderr}` : '')
}

function isCliOutputError(err: unknown): err is CliOutputError {
  return (
    err !== null &&
    typeof err === 'object' &&
    'stdout' in err &&
    typeof err.stdout === 'string' &&
    'stderr' in err &&
    typeof err.stderr === 'string'
  )
}

function testCommandLaunchFailure(err: unknown): RecordRedFailure {
  return {
    ok: false,
    reason: `test command failed to launch: ${err instanceof Error ? err.message : String(err)}`,
  }
}

function captureTestOutput(
  cmd: string,
  args: string[],
  dir: string,
  timeoutMs: number,
): CapturedTestOutput | RecordRedFailure {
  try {
    const r = runCli(cmd, args, { cwd: dir, timeoutMs })
    return { log: combineTestOutput(r.stdout, r.stderr), exitCode: r.exitCode }
  } catch (err: unknown) {
    if (
      isCliOutputError(err) &&
      typeof err.exitCode === 'number' &&
      err.exitCode > 0 &&
      err.timedOut !== true &&
      err.notFound !== true
    ) {
      return { log: combineTestOutput(err.stdout, err.stderr), exitCode: err.exitCode }
    }
    return testCommandLaunchFailure(err)
  }
}

/** Resolve current HEAD sha — this becomes the recorded test_commit_sha. */
function resolveHeadSha(dir: string, timeoutMs: number): string | RecordRedFailure {
  try {
    const r = runCli('git', ['rev-parse', 'HEAD'], { cwd: dir, timeoutMs })
    return r.stdout.trim()
  } catch (err) {
    return {
      ok: false,
      reason: `git rev-parse HEAD failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/**
 * #1988: refuse to record evidence that would point at a commit not actually
 * containing the RED test — either because `__tests__/**` is dirty (the
 * eventual test_commit_sha wouldn't yet include it) or because `testPath`
 * isn't present in HEAD at all. `--force` is the escape hatch for exotic
 * flows (e.g. re-recording evidence at a detached-worktree SHA).
 */
function checkTestCommitIntegrity(
  opts: RecordRedOptions,
  sha: string,
  dir: string,
): RecordRedFailure | null {
  if (opts.force) return null
  if (hasDirtyTestPaths(dir)) {
    return {
      ok: false,
      reason:
        `commit the RED test first — evidence must point at the commit that contains it ` +
        `(__tests__/** has uncommitted changes). Pass --force to override.`,
    }
  }
  if (!pathExistsInCommit(sha, opts.testPath, dir)) {
    return {
      ok: false,
      reason:
        `test_path "${opts.testPath}" not found in HEAD (${sha}) — evidence must point at a ` +
        `commit that contains the RED test. Pass --force to override.`,
    }
  }
  return null
}

/**
 * Task id embedded in a `task/#NNN[-slug]` (or `task/NNN[-slug]`) branch name,
 * or undefined when the branch doesn't follow the task-branch convention
 * (main, a detached-HEAD `HEAD`, a non-task feature branch, ...).
 */
export function taskIdFromBranch(branch: string): string | undefined {
  const m = branch.match(/^task\/#?(\d+)(?:-.*)?$/)
  return m ? `#${m[1]}` : undefined
}

/**
 * #2064: resolve the active task id from TWO authoritative sources — the current
 * git branch and the task-state document (`.claude/.task/status.json`) — and
 * fail closed on disagreement rather than silently trusting either. Worktree
 * open/close logs are deliberately never consulted here: they are historical
 * audit data, not current-task authority (issue #2064, resolution item 5).
 *
 * - Both agree, or only one resolves → use it (branch wins when the document
 *   has no active task at all).
 * - Both resolve to DIFFERENT ids → refuse; this is exactly the #503/#489
 *   incident (a stale task-document surviving a branch switch) that #2064 fixes.
 * - Neither resolves → the pre-existing "no active task" refusal.
 */
function resolveSelectedTaskId(
  requestedTaskId: string | undefined,
  activeTaskId: string,
  dir: string,
): { taskId: string } | RecordRedFailure {
  if (requestedTaskId === undefined) return { taskId: activeTaskId }

  let taskId: string
  try {
    taskId = normalizeChainId(requestedTaskId)
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
  if (taskId === activeTaskId || readUnifiedState(dir)?.chainIds?.includes(taskId)) {
    return { taskId }
  }
  return {
    ok: false,
    reason:
      `task ${taskId} is not the active task or a declared train secondary — ` +
      `add it with \`arbiter ship --chain-add ${taskId}\` before recording its RED evidence.`,
  }
}

function resolveActiveTaskId(
  dir: string,
  requestedTaskId?: string,
): { taskId: string } | RecordRedFailure {
  const docTaskId = readTaskId(dir)
  const branch = currentBranch(dir)
  const branchTaskId = taskIdFromBranch(branch)

  if (branchTaskId !== undefined && docTaskId !== undefined && branchTaskId !== docTaskId) {
    return {
      ok: false,
      reason:
        `branch/task-document mismatch — refusing to guess which task's evidence to record. ` +
        `branch "${branch}" resolves to task ${branchTaskId}; the task document ` +
        `(.claude/.task/status.json) says ${docTaskId}. Run \`arbiter task init --id ${branchTaskId}\` ` +
        `to realign the task document with the current branch (or switch to the intended branch).`,
    }
  }

  const taskId = branchTaskId ?? docTaskId
  if (taskId === undefined) {
    return {
      ok: false,
      reason: `no active task — run \`arbiter task init --id #NNN\` (or \`/task #NNN\`) to initialise the task first`,
    }
  }
  return resolveSelectedTaskId(requestedTaskId, taskId, dir)
}

export function runTaskRecordRed(opts: RecordRedOptions): RecordRedSuccess | RecordRedFailure {
  const dir = opts.dir ?? process.cwd()
  const timeoutMs = clampTimeout(opts.timeoutMs)

  const resolution = resolveActiveTaskId(dir, opts.taskId)
  if ('reason' in resolution) return resolution
  const taskId = resolution.taskId

  const shaOrErr = resolveHeadSha(dir, 5000)
  if (typeof shaOrErr === 'object') return shaOrErr
  const sha = shaOrErr

  const integrityFailure = checkTestCommitIntegrity(opts, sha, dir)
  if (integrityFailure) return integrityFailure

  // Select the test runner. An explicit `testCmd` overrides auto-selection so
  // users can scope an exact command (e.g. `go test -run TestFoo ./pkg`) — the
  // command is passed verbatim to spawnSync (shell:false), never interpolated.
  const testCmd = opts.testCmd ?? selectRunner(resolveLanguage(dir), opts.testPath)
  const outputOrErr = captureTestOutput(String(testCmd[0]), testCmd.slice(1), dir, timeoutMs)
  if ('ok' in outputOrErr) return outputOrErr
  if (outputOrErr.exitCode === 0) {
    return {
      ok: false,
      reason:
        'test command exited 0 (suite passed) — a RED phase requires a failing run; refusing to mint RED evidence',
    }
  }
  const log = repositoryRelativeLog(outputOrErr.log, dir)

  const sig = extractFailureSignature(log)
  if (sig === null) {
    return {
      ok: false,
      reason: `no recognised failure signature in test output — the test appears to pass or produced unrecognised output. Tests must be RED before recording evidence.`,
    }
  }

  // #2116: pin the test's CONTENT as well as the commit. The sha dies at the next
  // rebase; the blob survives it and lets the RED commit be re-resolved from it.
  const blob = blobShaInCommit(sha, opts.testPath, dir)

  const evidence: TddEvidence = {
    $schemaVersion: 1,
    task_id: taskId,
    test_path: opts.testPath,
    test_commit_sha: sha,
    ...(blob !== null ? { test_blob_sha: blob } : {}),
    test_run_log: log,
    observed_failure: sig.match,
    recorded_at: new Date().toISOString(),
    // Persist the exact command used (binary + args), so the evidence is
    // reproducible and the runner selection is auditable.
    test_command: [...testCmd],
  }

  return saveEvidence(dir, evidence, sig.framework)
}

/**
 * #2064: writeTddEvidence throws (rather than returning ok:false) when it
 * refuses to overwrite another task's evidence — surface it as a normal
 * record-red failure, not an uncaught exception. Split out of
 * `runTaskRecordRed` to keep that function's cyclomatic complexity within
 * the lint ceiling.
 */
function saveEvidence(
  dir: string,
  evidence: TddEvidence,
  framework: string,
): RecordRedSuccess | RecordRedFailure {
  try {
    const evidencePath = writeTddEvidence({ repoDir: dir, evidence })
    return { ok: true, evidencePath, framework }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}
