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

const DEFAULT_STALE_HOURS = 24

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
    // FAIL-OPEN-INTENT: corrupt open-log yields an EMPTY candidate set (reaper closes nothing it cannot prove)
  } catch {
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
    // FAIL-OPEN-INTENT: unreadable ref → null → caller surfaces a 'branch-missing' skip; guessing a date would risk reaping
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
    const verdict = classifyEntry(entry, opts.gitRoot, now, thresholdMs)
    if (verdict.kind === 'candidate') {
      candidates.push(verdict.candidate)
    } else {
      skipped.push(verdict.skip)
    }
  }

  return { candidates, skipped }
}

/** True when the branch is fully merged; null when the ref is unreadable. */
function mergedOrNull(entry: OpenLogEntry, gitRoot: string): boolean | null {
  try {
    return branchFullyMerged(entry.branch, entry.baseBranch, gitRoot, false)
    // FAIL-OPEN-INTENT: merged-check failed (unknown ref) — surfaced as a 'branch-missing' skip, never a candidate
  } catch {
    return null
  }
}

type EntryVerdict =
  { kind: 'candidate'; candidate: PruneCandidate } | { kind: 'skip'; skip: PruneSkip }

function skip(taskId: string, reason: PruneSkip['reason']): EntryVerdict {
  return { kind: 'skip', skip: { taskId, reason } }
}

/** Classify one open-log entry as a prune candidate or a skip (pure read). */
function classifyEntry(
  entry: OpenLogEntry,
  gitRoot: string,
  now: Date,
  thresholdMs: number,
): EntryVerdict {
  if (!existsSync(entry.worktreePath)) {
    return skip(entry.taskId, 'missing-dir')
  }
  if (workingTreeDirty(entry.worktreePath)) {
    return skip(entry.taskId, 'dirty')
  }

  const merged = mergedOrNull(entry, gitRoot)
  if (merged === null) {
    return skip(entry.taskId, 'branch-missing')
  }
  if (merged) {
    return {
      kind: 'candidate',
      candidate: {
        taskId: entry.taskId,
        worktreePath: entry.worktreePath,
        branch: entry.branch,
        reason: 'merged',
        lastActivity: entry.openedAt,
      },
    }
  }

  const commitIso = lastCommitIso(entry.branch, gitRoot)
  if (commitIso === null) {
    return skip(entry.taskId, 'branch-missing')
  }
  // Activity floor: a fresh branch with zero own commits reports the BASE
  // commit date (old) — openedAt keeps a just-opened worktree alive.
  const lastActivityMs = Math.max(new Date(entry.openedAt).getTime(), new Date(commitIso).getTime())
  if (now.getTime() - lastActivityMs > thresholdMs) {
    return {
      kind: 'candidate',
      candidate: {
        taskId: entry.taskId,
        worktreePath: entry.worktreePath,
        branch: entry.branch,
        reason: 'inactive',
        lastActivity: new Date(lastActivityMs).toISOString(),
      },
    }
  }
  return skip(entry.taskId, 'active')
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

interface PruneExecution {
  closedIds: string[]
  failed: Array<{ taskId: string; error: string }>
}

/** Close every candidate with per-candidate failure isolation. */
function executeCandidates(
  candidates: PruneCandidate[],
  noFetch: boolean,
  closeFn: (opts: WorktreeCloseOptions) => void,
): PruneExecution {
  const closedIds: string[] = []
  const failed: PruneExecution['failed'] = []
  for (const c of candidates) {
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
      // FAIL-OPEN-INTENT: per-candidate isolation — error surfaced in failed[] (printed + rethrown after the loop)
    } catch (err) {
      failed.push({ taskId: c.taskId, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { closedIds, failed }
}

/** Human-readable prune report; throws when any close failed (exit 1 at CLI). */
function emitPruneReport(
  emit: (line: string) => void,
  detected: { candidates: PruneCandidate[]; skipped: PruneSkip[] },
  execution: PruneExecution,
  staleHours: number,
  execute: boolean,
): void {
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
  emit(`Closed ${execution.closedIds.length} worktree(s).`)
  for (const f of execution.failed) {
    emit(`Failed to close ${f.taskId}: ${f.error}`)
  }
  if (execution.failed.length > 0) {
    throw new Error(`worktree prune: ${execution.failed.length} candidate(s) failed to close`)
  }
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

  const execution = execute
    ? executeCandidates(detected.candidates, noFetch, closeFn)
    : { closedIds: [], failed: [] }

  if (opts.json) {
    jsonOutput('worktree-prune', execution.failed.length === 0 ? 'ok' : 'error', {
      dryRun: !execute,
      staleHours,
      candidates: detected.candidates,
      skipped: detected.skipped,
      closed: execution.closedIds,
      failed: execution.failed,
    })
    return
  }

  emitPruneReport(emit, detected, execution, staleHours, execute)
}
