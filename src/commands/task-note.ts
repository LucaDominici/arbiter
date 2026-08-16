// SPDX-License-Identifier: Apache-2.0
//
// `arbiter note` (#1401) — zero-friction incidental-finding capture.
//
// When, while doing task X, an agent notices debt/smell/risk OUTSIDE X's scope, the ONLY in-band
// action is `arbiter note` (see `.claude/rules/60-incidental-capture.md`). This appends EXACTLY one
// JSON line to a per-shard spool under `.arbiter/findings/<shard>.jsonl`. Per-shard files make
// concurrent capture across parallel worktrees lost-update-safe: each agent writes its own shard.
//
// The spool is ephemeral by design (`.arbiter/**` is gitignored) — it is drained downstream, never
// committed. Non-blocking, no network, target <100ms.
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { sanitizeTaskId } from '../utils/task-id.js'
import { readTaskId } from './task-state.js'
import { currentBranch, headSha } from '../evidence/git-checks.js'
import { appendFileTranslated, ensureDir } from '../utils/fs.js'

export interface TaskNoteOptions {
  /** The finding text (positional `<note>` or `--note`). Required. */
  note: string
  /** Finding class, e.g. `dup`, `smell`, `risk`, `debt`. */
  kind?: string
  /** Severity band, e.g. `low`, `med`, `high`. */
  severity?: string
  /** Repo-relative file the finding concerns. */
  file?: string
  /** Line number the finding was seen at (NOT part of the fingerprint). */
  line?: number
  /** Project root (defaults to cwd). */
  dir?: string
  /** Optional graph-node id; OMITTED from the entry when absent. */
  graphNode?: string
  /** Nearest enclosing declaration/symbol; `''` when unknown. */
  symbol?: string
  /** Test seam: force a specific shard name (simulates a distinct worktree/agent). */
  shardOverride?: string
  /** Test seam: force the recorded sha (proves sha is excluded from the fingerprint). */
  shaOverride?: string
}

export interface TaskNoteSuccess {
  ok: true
  /** Absolute path of the per-shard spool the line was appended to. */
  spoolPath: string
  /** The dedup fingerprint of the appended finding. */
  fingerprint: string
}

export interface TaskNoteFailure {
  ok: false
  reason: string
}

/** Allowed finding classes (#1424a). Out-of-enum `--kind` is rejected, not silently stored. */
const NOTE_KINDS = ['dup', 'smell', 'risk', 'debt', 'note'] as const
/** Allowed severity bands (#1424a). Out-of-enum `--severity` is rejected. */
const NOTE_SEVERITIES = ['low', 'med', 'high', 'info'] as const

/** A single drained finding line. `graphNode` is omitted when absent. */
interface FindingEntry {
  ts: string
  note: string
  kind: string
  severity: string
  foundDuring: string
  file: string
  line: number | null
  sha: string
  graphNode?: string
  fingerprint: string
}

/**
 * Resolve the spool shard. Parallel-safe: an explicit active task id is the strongest key, then
 * the branch slug, then a short random token (so two anonymous agents never collide on one file).
 */
function resolveShard(opts: TaskNoteOptions, dir: string): string {
  if (opts.shardOverride !== undefined && opts.shardOverride.length > 0) {
    return sanitizeTaskId(opts.shardOverride)
  }
  const taskId = readTaskId(dir)
  if (taskId !== undefined && taskId.length > 0) return sanitizeTaskId(taskId)
  const branch = currentBranch(dir)
  if (branch !== 'unknown' && branch.length > 0) return sanitizeTaskId(branch)
  return 'anon-' + randomBytes(4).toString('hex')
}

/** Trim + collapse internal whitespace runs to a single space. NO lowercasing. */
function normalizeWhitespace(s: string): string {
  return s.trim().replace(/\s+/g, ' ')
}

/** Repo-relative POSIX path, or `''` when no file is given. */
function normalizePath(file: string | undefined): string {
  if (file === undefined || file.length === 0) return ''
  return file.replace(/\\/g, '/').replace(/^\.\//, '')
}

/**
 * Line-number-independent dedup fingerprint. INCLUDES kind + normalized path + symbol +
 * normalized note; EXCLUDES ts, sha, and line (so the same finding at line N and N+10 collides).
 */
function computeFingerprint(parts: {
  kind: string
  file: string
  symbol: string
  note: string
}): string {
  const material = [
    parts.kind,
    normalizePath(parts.file),
    parts.symbol,
    normalizeWhitespace(parts.note),
  ].join('\0')
  return createHash('sha1').update(material).digest('hex')
}

/** Assemble the finding entry; `graphNode` is omitted (not a key) when absent. */
function buildEntry(opts: TaskNoteOptions, dir: string, note: string): FindingEntry {
  const kind = opts.kind ?? 'note'
  const file = opts.file ?? ''
  const symbol = opts.symbol ?? ''
  const entry: FindingEntry = {
    ts: new Date().toISOString(),
    note,
    kind,
    severity: opts.severity ?? 'info',
    foundDuring: readTaskId(dir) ?? 'unknown',
    file: normalizePath(file),
    line: opts.line ?? null,
    sha: opts.shaOverride ?? headSha(dir),
    fingerprint: computeFingerprint({ kind, file, symbol, note }),
  }
  if (opts.graphNode !== undefined && opts.graphNode.length > 0) entry.graphNode = opts.graphNode
  return entry
}

export function runTaskNote(opts: TaskNoteOptions): TaskNoteSuccess | TaskNoteFailure {
  const dir = opts.dir ?? process.cwd()

  const note = opts.note.trim()
  if (note.length === 0) return { ok: false, reason: 'note text must not be empty' }

  if (opts.kind !== undefined && !(NOTE_KINDS as readonly string[]).includes(opts.kind)) {
    return {
      ok: false,
      reason: `invalid --kind "${opts.kind}" (expected one of: ${NOTE_KINDS.join('|')})`,
    }
  }
  if (
    opts.severity !== undefined &&
    !(NOTE_SEVERITIES as readonly string[]).includes(opts.severity)
  ) {
    return {
      ok: false,
      reason: `invalid --severity "${opts.severity}" (expected one of: ${NOTE_SEVERITIES.join('|')})`,
    }
  }

  const entry = buildEntry(opts, dir, note)
  const shard = resolveShard(opts, dir)
  const findingsDir = join(dir, '.arbiter', 'findings')
  const spoolPath = join(findingsDir, `${shard}.jsonl`)

  try {
    ensureDir(findingsDir)
    // Single atomic append of one newline-terminated line — per-shard file, so no lost update.
    appendFileTranslated(spoolPath, JSON.stringify(entry) + '\n')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: `findings spool write failed: ${msg}` }
  }

  return { ok: true, spoolPath, fingerprint: entry.fingerprint }
}
