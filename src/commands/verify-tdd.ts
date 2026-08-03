// SPDX-License-Identifier: Apache-2.0
import { loadTddEvidence, extractFailureSignature } from '../evidence/tdd.js'
import { resolveEvidenceCommit, pathExistsInCommit } from '../evidence/git-checks.js'
import { verifyRedExecution } from '../evidence/tdd-reexecute.js'

interface VerifyTddCheck {
  name: string
  pass: boolean
  reason?: string
}

export interface VerifyTddResult {
  status: 'PASS' | 'FAIL'
  exitCode: 0 | 1
  taskId: string
  reason?: string
  checks?: VerifyTddCheck[]
}

export interface VerifyTddOptions {
  taskId: string
  dir?: string
  json?: boolean
}

export function runVerifyTdd(opts: VerifyTddOptions): VerifyTddResult {
  const dir = opts.dir ?? process.cwd()
  const { taskId } = opts

  const checks: VerifyTddCheck[] = []

  // Check 1: evidence file present + schema valid
  const loadResult = loadTddEvidence(taskId, dir)
  if (!loadResult.ok) {
    return fail(taskId, loadResult.reason, [
      { name: 'evidence-file', pass: false, reason: loadResult.reason },
    ])
  }
  checks.push({ name: 'evidence-file', pass: true })

  const ev = loadResult.data

  // Check 2: task_id in evidence matches the requested taskId
  if (ev.task_id !== taskId) {
    const reason = `task_id mismatch: evidence contains "${ev.task_id}", expected "${taskId}"`
    return fail(taskId, reason, [...checks, { name: 'task-id-match', pass: false, reason }])
  }
  checks.push({ name: 'task-id-match', pass: true })

  // Check 3: failure signature present in log
  const sig = extractFailureSignature(ev.test_run_log)
  if (sig === null) {
    const reason = `no recognised failure signature found in test_run_log`
    return fail(taskId, reason, [...checks, { name: 'failure-signature', pass: false, reason }])
  }
  checks.push({ name: 'failure-signature', pass: true })

  // Check 4: the RED commit is reachable from HEAD — resolved through the rebase-stable
  // blob pin when the recorded sha was rewritten away by a rebase (#2116).
  const resolved = resolveEvidenceCommit(ev, dir)
  if (resolved === null) {
    const reason = unresolvedCommitReason(ev)
    return fail(taskId, reason, [...checks, { name: 'sha-on-branch', pass: false, reason }])
  }
  const redSha = resolved.sha
  checks.push(reachableCommitCheck(ev, resolved))

  // Check 5: test path exists in that commit
  const pathExists = pathExistsInCommit(redSha, ev.test_path, dir)
  if (!pathExists) {
    const reason = `test_path "${ev.test_path}" not found in commit ${redSha}`
    return fail(taskId, reason, [...checks, { name: 'test-path-in-commit', pass: false, reason }])
  }
  checks.push({ name: 'test-path-in-commit', pass: true })

  // Check 6: the recorded test_command genuinely reproduces observed_failure
  // when re-run from source at the resolved RED commit (#1957). The only check that
  // catches evidence naming a test that did not exist — or was not yet
  // failing — at the recorded commit (a real false-green found downstream).
  const reExec = verifyRedExecution({ ...ev, test_commit_sha: redSha }, dir)
  if (!reExec.ok) {
    const reason = reExec.reason ?? 'red-phase re-execution failed'
    return fail(taskId, reason, [...checks, { name: 'red-execution', pass: false, reason }])
  }
  checks.push({ name: 'red-execution', pass: true })

  return { status: 'PASS', exitCode: 0, taskId, checks }
}

function fail(taskId: string, reason: string, checks: VerifyTddCheck[]): VerifyTddResult {
  return { status: 'FAIL', exitCode: 1, taskId, reason, checks }
}

function unresolvedCommitReason(ev: {
  test_commit_sha: string
  test_blob_sha?: string | undefined
  test_path: string
}): string {
  const prefix = `test_commit_sha ${ev.test_commit_sha} is not reachable from HEAD`
  if (ev.test_blob_sha !== undefined) {
    return `${prefix} and no commit on this branch carries the recorded RED test content`
  }
  return (
    `${prefix} and this evidence predates the rebase-stable blob pin — re-record it with ` +
    `\`arbiter task record-red --test-path ${ev.test_path}\``
  )
}

function reachableCommitCheck(
  ev: { test_commit_sha: string },
  resolved: { sha: string; healed: boolean },
): VerifyTddCheck {
  if (!resolved.healed) return { name: 'sha-on-branch', pass: true }
  return {
    name: 'sha-on-branch',
    pass: true,
    reason:
      `pinned sha ${ev.test_commit_sha} was rewritten (rebase) — resolved to ${resolved.sha} ` +
      `via the recorded RED test blob`,
  }
}
