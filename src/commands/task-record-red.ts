// SPDX-License-Identifier: Apache-2.0
import { dirname } from 'node:path'
import { runCli } from '../utils/run-cli.js'
import { extractFailureSignature, writeTddEvidence, type TddEvidence } from '../evidence/tdd.js'
import { readTaskId } from './task-state.js'
import { loadConfig } from '../utils/config.js'
import { detectLanguage } from '../detectors/language.js'
import type { Language } from '../wizard/types.js'

export interface RecordRedOptions {
  testPath: string
  dir?: string
  /** Explicit test command (binary + args); overrides runner auto-selection. */
  testCmd?: readonly string[]
  /** Test-run timeout in ms. Default 60_000; clamped to [1000, 600_000]. */
  timeoutMs?: number
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

function captureTestOutput(
  cmd: string,
  args: string[],
  dir: string,
  timeoutMs: number,
): string | RecordRedFailure {
  try {
    const r = runCli(cmd, args, { cwd: dir, timeoutMs })
    return r.stdout + (r.stderr ? `\n${r.stderr}` : '')
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'stdout' in err && 'stderr' in err) {
      const e = err as { stdout: string; stderr: string }
      return e.stdout + (e.stderr ? `\n${e.stderr}` : '')
    }
    return {
      ok: false,
      reason: `test command failed to launch: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

export function runTaskRecordRed(opts: RecordRedOptions): RecordRedSuccess | RecordRedFailure {
  const dir = opts.dir ?? process.cwd()
  const timeoutMs = clampTimeout(opts.timeoutMs)

  const taskId = readTaskId(dir)
  if (taskId === undefined) {
    return {
      ok: false,
      reason: `no active task — run \`arbiter task init --id #NNN\` (or \`/task #NNN\`) to initialise the task first`,
    }
  }

  // Get current HEAD sha (this becomes the test commit sha)
  let sha: string
  try {
    const r = runCli('git', ['rev-parse', 'HEAD'], { cwd: dir, timeoutMs: 5000 })
    sha = r.stdout.trim()
  } catch (err) {
    return {
      ok: false,
      reason: `git rev-parse HEAD failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  // Select the test runner. An explicit `testCmd` overrides auto-selection so
  // users can scope an exact command (e.g. `go test -run TestFoo ./pkg`) — the
  // command is passed verbatim to spawnSync (shell:false), never interpolated.
  const testCmd = opts.testCmd ?? selectRunner(resolveLanguage(dir), opts.testPath)
  const logOrErr = captureTestOutput(String(testCmd[0]), testCmd.slice(1), dir, timeoutMs)
  if (typeof logOrErr === 'object' && 'ok' in logOrErr) return logOrErr
  const log = logOrErr

  const sig = extractFailureSignature(log)
  if (sig === null) {
    return {
      ok: false,
      reason: `no recognised failure signature in test output — the test appears to pass or produced unrecognised output. Tests must be RED before recording evidence.`,
    }
  }

  const evidence: TddEvidence = {
    $schemaVersion: 1,
    task_id: taskId,
    test_path: opts.testPath,
    test_commit_sha: sha,
    test_run_log: log,
    observed_failure: sig.match,
    recorded_at: new Date().toISOString(),
    // Persist the exact command used (binary + args), so the evidence is
    // reproducible and the runner selection is auditable.
    test_command: [...testCmd],
  }

  const evidencePath = writeTddEvidence({ repoDir: dir, evidence })
  return { ok: true, evidencePath, framework: sig.framework }
}
