// SPDX-License-Identifier: Apache-2.0
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CliError, runCli } from '../utils/run-cli.js'
import { extractFailureSignature, type TddEvidence } from './tdd.js'
import { gitCwd } from './git-checks.js'
import { mkdtempTranslated, rmTranslated, symlinkTranslated } from '../utils/fs.js'

export interface RedExecutionResult {
  ok: boolean
  reason?: string
}

/** Default timeout for the re-run itself. Matches record-red's own default (#1951). */
export const DEFAULT_REEXEC_TIMEOUT_MS = 120_000

/**
 * Re-derive the recorded RED phase from source instead of trusting the
 * evidence file's own prose. Checks out `test_commit_sha` into an isolated,
 * detached git worktree (never touches the caller's working tree) and
 * re-runs the exact recorded `test_command` there. The failure signature
 * re-extracted from that fresh run must match the recorded `observed_failure`
 * byte-for-byte.
 *
 * Closes the false-green found in a downstream project (#1957): evidence
 * named a specific failing test whose `test_commit_sha` predated the test's
 * own existence — the file existed at that commit, the test did not. Neither
 * `sha-on-branch` nor `test-path-in-commit` re-run anything, so both passed
 * anyway. Re-executing the recorded command against the recorded commit's
 * real source is the only check that can catch this: at that commit the
 * named test either doesn't run at all (and the rest of the file/package
 * was already green) or fails differently — either way the recorded failure
 * cannot be reproduced.
 */
export function verifyRedExecution(
  ev: TddEvidence,
  dir?: string,
  timeoutMs: number = DEFAULT_REEXEC_TIMEOUT_MS,
): RedExecutionResult {
  const testCommand = ev.test_command
  if (testCommand === undefined || testCommand.length === 0) {
    return {
      ok: false,
      reason:
        'evidence has no recorded test_command — legacy evidence predating #1957 cannot be ' +
        're-verified against source; re-record with `arbiter task record-red` to upgrade',
    }
  }

  const repoDir = gitCwd(dir)
  const worktreeDir = freeTempPath()
  try {
    const added = addDetachedWorktree(repoDir, worktreeDir, ev.test_commit_sha)
    if (!added.ok) return added

    linkNodeModules(dir ?? repoDir, worktreeDir)

    const freshLog = runTestCommand(testCommand, worktreeDir, timeoutMs)
    return compareFailure(ev, freshLog)
  } finally {
    removeDetachedWorktree(repoDir, worktreeDir)
  }
}

function compareFailure(ev: TddEvidence, freshLog: string): RedExecutionResult {
  const freshSig = extractFailureSignature(freshLog)
  if (freshSig === null) {
    return {
      ok: false,
      reason:
        `test_command [${ev.test_command?.join(' ') ?? ''}] did not fail when re-run at ` +
        `test_commit_sha ${ev.test_commit_sha} — the recorded RED phase could not be ` +
        'reproduced from source (false-green risk)',
    }
  }
  if (freshSig.match !== ev.observed_failure) {
    return {
      ok: false,
      reason:
        `re-run at test_commit_sha ${ev.test_commit_sha} failed with "${freshSig.match}", not ` +
        `the recorded observed_failure "${ev.observed_failure}" — the named failure may not ` +
        'have existed at that commit',
    }
  }
  return { ok: true }
}

/** A unique path that does not exist yet — `git worktree add` creates it. */
function freeTempPath(): string {
  const d = mkdtempTranslated(join(tmpdir(), 'arbiter-tdd-verify-'))
  rmTranslated(d, { recursive: true, force: true })
  return d
}

function addDetachedWorktree(
  repoDir: string,
  worktreeDir: string,
  sha: string,
): { ok: true } | { ok: false; reason: string } {
  try {
    const r = runCli('git', ['worktree', 'add', '--detach', '--force', worktreeDir, sha], {
      cwd: repoDir,
      timeoutMs: 30_000,
    })
    if (r.exitCode !== 0) {
      return {
        ok: false,
        reason: `failed to check out test_commit_sha ${sha} in an isolated worktree: ${r.stderr.trim()}`,
      }
    }
    return { ok: true }
  } catch (err) {
    const detail = err instanceof CliError ? err.stderr || err.message : String(err)
    return {
      ok: false,
      reason: `failed to check out test_commit_sha ${sha} in an isolated worktree: ${detail}`,
    }
  }
}

/**
 * Reuse the caller's installed node_modules so the re-run proves the
 * recorded SOURCE at test_commit_sha genuinely fails, not that packages can
 * be reinstalled offline. Go/Python resolve dependencies outside the repo
 * tree (module cache / PATH), so no equivalent link is needed there.
 */
function linkNodeModules(sourceDir: string, worktreeDir: string): void {
  const src = join(sourceDir, 'node_modules')
  const dest = join(worktreeDir, 'node_modules')
  if (!existsSync(src) || existsSync(dest)) return
  try {
    symlinkTranslated(src, dest, 'dir')
    // FAIL-OPEN-INTENT: a missing link surfaces downstream as a genuine check failure (npx can't resolve the runner), never a false PASS.
  } catch {
    // no-op — see FAIL-OPEN-INTENT above
  }
}

function runTestCommand(testCommand: readonly string[], cwd: string, timeoutMs: number): string {
  const [cmd, ...args] = testCommand
  if (cmd === undefined) return ''
  try {
    const r = runCli(cmd, args, { cwd, timeoutMs })
    return r.stdout + (r.stderr ? `\n${r.stderr}` : '')
  } catch (err) {
    if (err instanceof CliError) return err.stdout + (err.stderr ? `\n${err.stderr}` : '')
    return ''
  }
}

function removeDetachedWorktree(repoDir: string, worktreeDir: string): void {
  try {
    runCli('git', ['worktree', 'remove', '--force', worktreeDir], {
      cwd: repoDir,
      timeoutMs: 30_000,
    })
    // FAIL-OPEN-INTENT: cleanup is best-effort — the unconditional rmSync below guarantees the directory is gone regardless of this command's outcome.
  } catch {
    // no-op — see FAIL-OPEN-INTENT above
  }
  rmTranslated(worktreeDir, { recursive: true, force: true })
}
