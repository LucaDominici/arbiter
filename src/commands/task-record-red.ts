// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runCli } from '../utils/run-cli.js'
import { extractFailureSignature, writeTddEvidence, type TddEvidence } from '../evidence/tdd.js'

export interface RecordRedOptions {
  testPath: string
  dir?: string
  testCmd?: readonly string[]
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

function captureTestOutput(cmd: string, args: string[], dir: string): string | RecordRedFailure {
  try {
    const r = runCli(cmd, args, { cwd: dir, timeoutMs: 60_000 })
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
  const claudeDir = join(dir, '.claude')

  const taskIdFile = join(claudeDir, '.task-id')
  if (!existsSync(taskIdFile)) {
    return {
      ok: false,
      reason: `.claude/.task-id not found — run \`arbiter task advance --to preflight\` to initialise the task first`,
    }
  }
  const taskId = readFileSync(taskIdFile, 'utf-8').trim()
  if (!taskId) {
    return { ok: false, reason: `.claude/.task-id is empty` }
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

  // Run the test, capture output (expect it to fail)
  const testCmd = opts.testCmd ?? ['npx', 'vitest', 'run', opts.testPath]
  const logOrErr = captureTestOutput(String(testCmd[0]), testCmd.slice(1), dir)
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
  }

  const evidencePath = writeTddEvidence({ repoDir: dir, evidence })
  return { ok: true, evidencePath, framework: sig.framework }
}
