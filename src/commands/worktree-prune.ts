// SPDX-License-Identifier: Apache-2.0
/**
 * `arbiter worktree prune --stale [hours]` — zombie-worktree reaper (#1873 T5, M3).
 *
 * On worker CRASH (not escalate) nobody closes the worktree: the dir, branch
 * and log entry rot until a human runs /wt-prune by hand. This deterministic
 * leaf primitive (ADR-103 §2) detects reap candidates from REAL state (open
 * log + git), never from memory:
 *
 *   candidate = registered worktree with a CLEAN tree AND
 *               (branch fully merged OR no activity within --stale hours)
 *
 * A dirty tree is NEVER a candidate (INV-96: uncertainty is not a decision —
 * uncommitted work must be looked at by someone). Dry-run is the DEFAULT;
 * `--execute` applies. Inactive-unmerged candidates are closed with
 * keepBranch: committed work survives on the branch.
 *
 * CANON-16 Existing Code Survey:
 *   - src/commands/worktree.ts: open-log shape (OpenLogEntry/isOpenLogEntry)
 *     and runWorktreeClose (reused as the close path — no second teardown).
 *   - src/worktree/validate.ts: workingTreeDirty + branchFullyMerged reused
 *     verbatim (same truth the close guard uses).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runCli } from '../utils/run-cli.js'
import { jsonOutput } from '../utils/json-output.js'
import { isRunningFromMainRepo, workingTreeDirty, branchFullyMerged } from '../worktree/validate.js'
import { isOpenLogEntry, runWorktreeClose } from './worktree.js'
import type { OpenLogEntry, WorktreeCloseOptions } from './worktree.js'

export const DEFAULT_STALE_HOURS = 24

export interface PruneCandidate {
  taskId: string
  worktreePath: string
  branch: string
  reason: 'merged' | 'inactive'
  /** ISO timestamp of the last observed activity (openedAt floor ∨ last commit). */
  lastActivity: string
}

export interface PruneSkip {
  taskId: string
  reason: 'missing-dir' | 'dirty' | 'active' | 'branch-missing'
}

export interface DetectPruneOptions {
  gitRoot: string
  staleHours: number
  /** Skip `git fetch origin` before the merged check (tests / offline). */
  noFetch: boolean
  /** Injected clock (tests). */
  now?: Date
}

function readOpenLog(gitRoot: string): OpenLogEntry[] {
  const logPath = join(gitRoot, '.arbiter', 'worktree-open.log.json')
  if (!existsSync(logPath)) return []
  try {
    const raw: unknown = JSON.parse(readFileSync(logPath, 'utf-8'))
    if (!Array.isArray(raw)) return []
    return raw.filter(isOpenLogEntry)
  } catch {
    // Corrupt log: nothing provable to prune — fail-closed empty set.
    return []
  }
}

/** Last commit date on the branch, ISO — null when the ref is unreadable. */
function lastCommitIso(branch: string, gitRoot: string): string | null {
  try {
    const out = runCli('git', ['log', '-1', '--format=%cI', branch, '--'], {
      cwd: gitRoot,
    }).stdout.trim()
    return out.length > 0 ? out : null
  } catch {
    return null
  }
}

/**
 * Detect reap candidates from the open log + git state. Pure read — never
 * modifies the filesystem or git.
 */
export function detectPruneCandidates(opts: DetectPruneOptions): {
  candidates: PruneCandidate[]
  skipped: PruneSkip[]
} {
  const now = opts.now ?? new Date()
  const thresholdMs = opts.staleHours * 60 * 60 * 1000
  const candidates: PruneCandidate[] = []
  const skipped: PruneSkip[] = []

  // One fetch up front (not per-branch) so N merged-checks stay cheap.
  if (!opts.noFetch) {
    try {
      runCli('git', ['fetch', 'origin'], { cwd: opts.gitRoot, timeoutMs: 30_000 })
    } catch {
      process.stderr.write('Warning: git fetch failed — merged checks may use stale refs\n')
    }
  }

  for (const entry of readOpenLog(opts.gitRoot)) {
    if (!existsSync(entry.worktreePath)) {
      skipped.push({ taskId: entry.taskId, reason: 'missing-dir' })
      continue
    }
    if (workingTreeDirty(entry.worktreePath)) {
      skipped.push({ taskId: entry.taskId, reason: 'dirty' })
      continue
    }

    let merged = false
    try {
      merged = branchFullyMerged(entry.branch, entry.baseBranch, opts.gitRoot, false)
    } catch {
      skipped.push({ taskId: entry.taskId, reason: 'branch-missing' })
      continue
    }
    if (merged) {
      candidates.push({
        taskId: entry.taskId,
        worktreePath: entry.worktreePath,
        branch: entry.branch,
        reason: 'merged',
        lastActivity: entry.openedAt,
      })
      continue
    }

    const commitIso = lastCommitIso(entry.branch, opts.gitRoot)
    if (commitIso === null) {
      skipped.push({ taskId: entry.taskId, reason: 'branch-missing' })
      continue
    }
    // Activity floor: a fresh branch with zero own commits reports the BASE
    // commit date (old) — openedAt keeps a just-opened worktree alive.
    const lastActivityMs = Math.max(
      new Date(entry.openedAt).getTime(),
      new Date(commitIso).getTime(),
    )
    if (now.getTime() - lastActivityMs > thresholdMs) {
      candidates.push({
        taskId: entry.taskId,
        worktreePath: entry.worktreePath,
        branch: entry.branch,
        reason: 'inactive',
        lastActivity: new Date(lastActivityMs).toISOString(),
      })
    } else {
      skipped.push({ taskId: entry.taskId, reason: 'active' })
    }
  }

  return { candidates, skipped }
}

export interface WorktreePruneOptions {
  cwd?: string
  staleHours?: number
  /** Apply the prune. Default: dry-run (report only). */
  execute?: boolean
  noFetch?: boolean
  json?: boolean | undefined
  /** Injected clock (tests). */
  now?: Date
  /** Receive output lines instead of printing them (tests). */
  onLine?: (line: string) => void
  /** Close implementation (tests) — defaults to runWorktreeClose. */
  closeFn?: (opts: WorktreeCloseOptions) => void
}

export function runWorktreePrune(opts: WorktreePruneOptions = {}): void {
  const cwd = opts.cwd ?? process.cwd()
  const gitRoot = runCli('git', ['rev-parse', '--show-toplevel'], { cwd }).stdout.trim() || cwd
  const emit =
    opts.onLine ??
    ((line: string): void => {
      process.stdout.write(`${line}\n`)
    })
  const closeFn = opts.closeFn ?? runWorktreeClose
  const staleHours = opts.staleHours ?? DEFAULT_STALE_HOURS
  const noFetch = opts.noFetch ?? false
  const execute = opts.execute ?? false

  if (!isRunningFromMainRepo(gitRoot)) {
    throw new Error("Must run 'worktree prune' from the main repository, not a worktree.")
  }

  const detected = detectPruneCandidates({
    gitRoot,
    staleHours,
    noFetch,
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  })

  const closedIds: string[] = []
  const failed: Array<{ taskId: string; error: string }> = []

  if (execute) {
    for (const c of detected.candidates) {
      // Belt-and-braces INV-96 re-check: the inactive path closes with
      // force (skips the merge check), which also skips the dirty guard —
      // so re-verify cleanliness right before teardown.
      if (workingTreeDirty(c.worktreePath)) {
        failed.push({ taskId: c.taskId, error: 'tree became dirty between detect and close' })
        continue
      }
      try {
        closeFn({
          taskId: c.taskId,
          noFetch,
          ...(c.reason === 'inactive' ? { force: true, keepBranch: true } : {}),
        })
        closedIds.push(c.taskId)
      } catch (err) {
        failed.push({ taskId: c.taskId, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  if (opts.json) {
    jsonOutput('worktree-prune', failed.length === 0 ? 'ok' : 'error', {
      dryRun: !execute,
      staleHours,
      candidates: detected.candidates,
      skipped: detected.skipped,
      closed: closedIds,
      failed,
    })
    return
  }

  emit(`Prune candidates (${detected.candidates.length}), threshold ${staleHours}h:`)
  for (const c of detected.candidates) {
    emit(`  ${c.reason.padEnd(8)}  ${c.taskId}  ${c.branch}  ${c.worktreePath}`)
  }
  if (detected.skipped.length > 0) {
    emit(`Skipped (${detected.skipped.length}):`)
    for (const s of detected.skipped) {
      emit(`  ${s.reason.padEnd(13)}  ${s.taskId}`)
    }
  }
  if (!execute) {
    emit('Dry-run — nothing closed. Re-run with --execute to close these worktrees.')
    return
  }
  emit(`Closed ${closedIds.length} worktree(s).`)
  for (const f of failed) {
    emit(`Failed to close ${f.taskId}: ${f.error}`)
  }
  if (failed.length > 0) {
    throw new Error(`worktree prune: ${failed.length} candidate(s) failed to close`)
  }
}
