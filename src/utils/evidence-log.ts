// SPDX-License-Identifier: Apache-2.0
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** Schema of a single JSONL entry written to .evidence/cmd-log.jsonl */
export interface EvidenceEntry {
  ts: string
  cmd: string
  args: string[]
  exit: number
  durationMs: number
  headSha: string
}

const LOG_FILENAME = 'cmd-log.jsonl'
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024 // 10 MB

/**
 * Commands that only print and exit. They must never touch the filesystem —
 * `arbiter --version` in an empty directory used to leave a `.evidence/` behind (#2218).
 * The empty string is the bare `arbiter` invocation (Commander prints help).
 */
const INFORMATIONAL_COMMANDS: ReadonlySet<string> = new Set([
  '',
  '-V',
  '--version',
  '-h',
  '--help',
  'help',
])

/**
 * Directory the command log belongs to, or `null` when nothing may be written (#2218).
 *
 * Evidence belongs to a PROJECT: the nearest ancestor of `cwd` holding an `arbiter.json`.
 * Outside a project there is nothing to attach evidence to, and writing would scatter
 * `.evidence/` into unrelated repositories. Informational commands never write at all.
 */
export function evidenceLogTarget(cwd: string, cmd: string): string | null {
  if (INFORMATIONAL_COMMANDS.has(cmd)) return null
  let dir = resolve(cwd)
  for (;;) {
    if (existsSync(join(dir, 'arbiter.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * Process-local monotonic rotation counter. Combined with the pid it makes every
 * rotated-backup name unique even when a single process rotates several times
 * within the same millisecond (Date.now() resolution is too coarse on its own).
 */
let rotationCounter = 0

export interface AppendEvidenceOptions {
  /** Root directory of the project (`.evidence/` is created inside it). Defaults to `process.cwd()`. */
  dir?: string
  /** Byte threshold for rotation. Defaults to 10 MB. */
  maxBytes?: number
  /** When true, skip logging entirely (--no-evidence). */
  noEvidence?: boolean
}

/**
 * Append one JSONL line to `.evidence/cmd-log.jsonl`.
 *
 * - Creates `.evidence/` directory if absent.
 * - Rotates (renames the live log aside) when file size >= maxBytes.
 * - NEVER throws — evidence logging must not break CLI invocations.
 *
 * Concurrency (#1556): the rotation rename is isolated in its own try/catch so a
 * lost race (a peer process already renamed the log → ENOENT here) can never skip
 * the subsequent append, and the backup gets a process-unique suffix so two
 * processes crossing the boundary together never clobber each other's history.
 */
export function appendEvidenceLine(entry: EvidenceEntry, opts: AppendEvidenceOptions = {}): void {
  if (opts.noEvidence) return

  try {
    const root = opts.dir ?? process.cwd()
    const evidenceDir = join(root, '.evidence')
    const logPath = join(evidenceDir, LOG_FILENAME)
    const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES

    mkdirSync(evidenceDir, { recursive: true })

    // Check size and rotate if needed
    let shouldRotate = false
    try {
      const stat = statSync(logPath)
      if (stat.size >= maxBytes) shouldRotate = true
    } catch {
      // File doesn't exist yet — no rotation needed
    }

    if (shouldRotate) {
      // Isolated: a concurrent rotator may have already moved the log out from
      // under us (renameSync → ENOENT). Swallow that here so the append below
      // ALWAYS runs — otherwise this process's entry would be silently dropped.
      // The unique suffix (pid + epoch ms + monotonic counter) keeps a second
      // rotator — in another process OR a later rotation in this one — from
      // overwriting an earlier rotation's history with its own near-empty log.
      const backupName = `${LOG_FILENAME}.${process.pid}.${Date.now()}.${++rotationCounter}`
      try {
        renameSync(logPath, join(evidenceDir, backupName))
      } catch {
        // Rotation lost the race (or the file vanished) — fine, the append recovers.
      }
    }

    appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf-8')
  } catch {
    // Swallow all errors — evidence logging is best-effort
  }
}
