// SPDX-License-Identifier: Apache-2.0
/**
 * Temporal history harvester for the provenance graph (#263).
 *
 * Reads git log entries and builds a structured history of events for
 * governance artefacts. Parses Notary footer sections from commit messages
 * to harvest Delta/Intent/Patch information.
 *
 * Existing Code Survey (CANON-16):
 *   - grep "export.*history\|export.*History\|export.*temporal" src/ — nothing found
 *   - grep "export.*GitLog\|export.*gitLog" src/ — nothing found
 *   - Decision: new file justified — no temporal harvesting exists in src/
 *
 * #263
 */

import { runCli } from '../utils/run-cli.js'

/** A raw parsed git log entry. */
export interface GitLogEntry {
  /** Full commit SHA (40 chars). */
  sha: string
  /** ISO 8601 timestamp (from --date=iso-strict). */
  ts: string
  /** First line of commit message. */
  subject: string
  /** Full commit body (lines after blank line separator), may be empty. */
  body: string
}

/** A structured history event derived from a git log entry. */
export interface HistoryEvent {
  sha: string
  ts: string
  subject: string
  /** Files changed in this commit (empty when not available). */
  filesChanged: string[]
  /** Extracted Notary intent (from `- Intent:` line), if present. */
  notaryIntent?: string
}

// ── Git log parsing ────────────────────────────────────────────────────────

const GIT_LOG_SEPARATOR = '---ARBITER-LOG-ENTRY---'
const GIT_LOG_FORMAT = `--format=format:${GIT_LOG_SEPARATOR}%n%H%n%aI%n%s%n%b`

/**
 * Run git log in the given directory and return structured entries.
 * Returns an empty array when git is unavailable or the directory is not
 * a git repository.
 *
 * The optional pathspec limits the log to commits touching a specific file.
 */
function runGitLog(opts: { cwd: string; pathspec?: string; maxEntries?: number }): GitLogEntry[] {
  const args: string[] = ['log', GIT_LOG_FORMAT, '--date=iso-strict', '--reverse']

  if (opts.maxEntries !== undefined) {
    args.push(`-${opts.maxEntries}`)
  }

  if (opts.pathspec !== undefined) {
    args.push('--', opts.pathspec)
  }

  let stdout: string
  try {
    const result = runCli('git', args, { cwd: opts.cwd, timeoutMs: 15_000 })
    stdout = result.stdout
  } catch {
    return []
  }

  return parseGitLogOutput(stdout)
}

/**
 * Parse the raw stdout from git log into GitLogEntry objects.
 */
function parseGitLogOutput(raw: string): GitLogEntry[] {
  const entries: GitLogEntry[] = []
  const blocks = raw.split(GIT_LOG_SEPARATOR).filter((b) => b.trim() !== '')

  for (const block of blocks) {
    const lines = block.trimStart().split('\n')
    const sha = (lines[0] ?? '').trim()
    const ts = (lines[1] ?? '').trim()
    const subject = (lines[2] ?? '').trim()

    if (sha === '' || ts === '') continue

    // Body starts at line 3 (skip blank separator line)
    const bodyLines = lines.slice(3)
    const body = bodyLines.join('\n').trim()

    entries.push({ sha, ts, subject, body })
  }

  return entries
}

// ── Notary footer extraction ───────────────────────────────────────────────

const NOTARY_INTENT_RE = /^-\s+Intent:\s+(.+)$/m

function extractNotaryIntent(body: string): string | undefined {
  if (body === '') return undefined
  const match = body.match(NOTARY_INTENT_RE)
  if (!match) return undefined
  return (match[1] ?? '').trim()
}

// ── Event parsing ──────────────────────────────────────────────────────────

/**
 * Convert raw GitLogEntry list into structured HistoryEvents.
 * Returns events sorted ascending by ts (oldest first).
 */
export function parseHistoryEvents(entries: GitLogEntry[]): HistoryEvent[] {
  const events: HistoryEvent[] = entries.map((entry) => {
    const notaryIntent = extractNotaryIntent(entry.body)
    return {
      sha: entry.sha,
      ts: entry.ts,
      subject: entry.subject,
      filesChanged: [],
      ...(notaryIntent !== undefined ? { notaryIntent } : {}),
    }
  })

  // Sort ascending by ts
  events.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
  return events
}

/**
 * Filter a set of HistoryEvents to those relevant for a given node.
 *
 * Relevance rules:
 *   - For INV/ADR/REQ/CANON nodes: subject or notaryIntent contains the node id
 *   - For FILE: nodes: any event where filesChanged includes the path component
 *     (strip the "FILE:" prefix and match against filesChanged)
 */
export function filterEventsForNode(events: HistoryEvent[], nodeId: string): HistoryEvent[] {
  const isFile = nodeId.startsWith('FILE:')

  if (isFile) {
    const filePath = nodeId.slice('FILE:'.length)
    return events.filter((e) => e.filesChanged.some((f) => f === filePath || f.endsWith(filePath)))
  }

  // For all other kinds: match by node id appearing in subject or intent
  return events.filter(
    (e) =>
      e.subject.includes(nodeId) ||
      (e.notaryIntent !== undefined && e.notaryIntent.includes(nodeId)),
  )
}

// ── Harvesting API ─────────────────────────────────────────────────────────

/**
 * Harvest history events for a node from git log.
 *
 * For FILE: nodes, restricts the git log to the file's pathspec (faster).
 * For all other nodes, runs a full log and filters by node id.
 */
export function harvestHistoryForNode(opts: {
  nodeId: string
  gitDir: string
  maxEntries?: number
}): HistoryEvent[] {
  const isFile = opts.nodeId.startsWith('FILE:')
  const pathspec = isFile ? opts.nodeId.slice('FILE:'.length) : undefined

  const logOpts: { cwd: string; pathspec?: string; maxEntries?: number } = {
    cwd: opts.gitDir,
  }
  if (pathspec !== undefined) logOpts.pathspec = pathspec
  if (opts.maxEntries !== undefined) logOpts.maxEntries = opts.maxEntries

  const entries = runGitLog(logOpts)

  const events = parseHistoryEvents(entries)

  if (isFile) {
    // For FILE: nodes, all entries from the file-scoped log are relevant
    return events
  }

  return filterEventsForNode(events, opts.nodeId)
}
