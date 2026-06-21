// Arbiter hook library — shared utilities for all hooks
// Project: arbiter
import { mkdirSync, appendFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseArgs } from '../../scripts/lib/suppressions-shared.mjs'

const PROJECT = 'arbiter'
const LOG_DIR = '.claude/hooks/logs'
const LOG_FILE = `${LOG_DIR}/hook-events.log`

mkdirSync(LOG_DIR, { recursive: true })

function logEvent(level, message) {
  const ts = new Date().toISOString()
  appendFileSync(LOG_FILE, `[${ts}] [${PROJECT}] [${level}] ${message}\n`)
}

export const logInfo = (msg) => logEvent('INFO', msg)
export const logWarn = (msg) => logEvent('WARN', msg)
export const logError = (msg) => logEvent('ERROR', msg)

/**
 * Checks whether an inline arbiter-suppress directive on the same or previous line
 * covers the given invariant ID. Returns true if a valid, non-expired directive is found.
 * @param {string} fileContent - full file content
 * @param {number} lineIndex - 0-based line index of the violation
 * @param {string|null} invId - e.g. "INV-04", or null to match any valid directive
 */
export function findInlineSuppression(fileContent, lineIndex, invId) {
  const lines = fileContent.split('\n')
  const candidateLines = [lines[lineIndex]]
  if (lineIndex > 0) candidateLines.unshift(lines[lineIndex - 1])

  const SUPPRESS_RE = /\/\/\s*arbiter-suppress\(([^)]+)\)/

  for (const line of candidateLines) {
    const m = SUPPRESS_RE.test(line) ? line.match(SUPPRESS_RE) : null
    if (!m) continue

    const argsStr = m[1]
    const parts = parseArgs(argsStr)
    if (parts.length === 0) continue

    const firstPart = parts[0]
    if (invId !== null && firstPart !== invId) continue

    const kvPairs = {}
    for (let i = 1; i < parts.length; i++) {
      const eqIdx = parts[i].indexOf('=')
      if (eqIdx === -1) continue
      const key = parts[i].slice(0, eqIdx).trim()
      let val = parts[i].slice(eqIdx + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      kvPairs[key] = val
    }

    if (!kvPairs.until || !kvPairs.reason || !kvPairs.owner) continue

    const expiry = new Date(kvPairs.until)
    if (isNaN(expiry.getTime())) continue
    if (expiry.getTime() < Date.now()) continue
    if (kvPairs.reason.length < 10) continue

    return true
  }
  return false
}

/**
 * Sanitize a task id into a safe filesystem segment AND safe regex literal.
 * MUST stay in lockstep with `src/review/dispatch.ts::sanitizeTaskId`.
 * Parity enforced by `__tests__/lib/sanitize-task-id-parity.test.ts`.
 */
export function sanitizeTaskId(raw) {
  const cleaned = String(raw ?? '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64)
  return cleaned.length > 0 ? cleaned : 'unknown'
}

/**
 * Resolve the path of the file a tool is about to edit / has just edited.
 *
 * The Claude Code hook protocol delivers tool input as a JSON object on stdin
 * (`{ tool_name, tool_input: { file_path, ... } }`). The Codex adapter, by
 * contrast, translates that payload into the `CLAUDE_TOOL_INPUT_PATH`
 * environment variable before delegating to the hook. A hook that reads only
 * the env var silently no-ops under the stdin-JSON protocol (it sees an empty
 * path and exits 0 without inspecting the file). This resolver accepts BOTH:
 * it prefers the stdin-JSON `tool_input.file_path`, then falls back to the env
 * var (Codex path). Returns '' when neither is present.
 *
 * stdin (fd 0) is consumed at most once and only when it is a pipe/file; on a
 * TTY or when no payload is available it returns '' without blocking.
 *
 * @param {string} [rawStdin] Optional pre-read stdin payload (tests / callers
 *   that already buffered fd 0). When omitted, fd 0 is read directly.
 * @returns {string} The resolved file path, or '' if none could be determined.
 */
export function resolveToolInputPath(rawStdin) {
  let raw = rawStdin
  if (typeof raw !== 'string') {
    raw = ''
    try {
      // Reading fd 0 throws EAGAIN on an interactive TTY with no piped input;
      // treat any read failure as "no stdin payload" and fall through to env.
      raw = readFileSync(0, 'utf-8')
    } catch {
      raw = ''
    }
  }
  const trimmed = raw.trim()
  if (trimmed) {
    try {
      const payload = JSON.parse(trimmed)
      const fromStdin = payload?.tool_input?.file_path
      if (typeof fromStdin === 'string' && fromStdin.length > 0) {
        return fromStdin
      }
    } catch {
      // Not JSON (or not the expected shape) — fall through to the env fallback.
    }
  }
  const fromEnv = process.env.CLAUDE_TOOL_INPUT_PATH
  return typeof fromEnv === 'string' ? fromEnv : ''
}

/** Returns the git repository root, falling back to process.cwd(). */
export function getRepoRoot() {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf-8',
  })
  if (result.status === 0 && result.stdout) {
    return result.stdout.trim()
  }
  logWarn('getRepoRoot: git rev-parse failed, falling back to cwd')
  return process.cwd()
}

/**
 * Reads task state from the unified document `.claude/.task/status.json` in the given root.
 * Returns defaults ('unknown') when the document is absent or unreadable.
 */
export function readTaskState(root) {
  const statusPath = join(root, '.claude', '.task', 'status.json')
  let state = {}
  if (existsSync(statusPath)) {
    try {
      state = JSON.parse(readFileSync(statusPath, 'utf-8'))
    } catch (err) {
      // Fail visibly: a corrupt document silently disarms phase-gated guards, so warn rather
      // than treat corruption as a fresh tree.
      process.stderr.write(
        `[arbiter] warn: ${statusPath} is unreadable (${err.message}); treating task state as unknown.\n`,
      )
      state = {}
    }
  }
  const pick = (v) => (typeof v === 'string' && v.length > 0 ? v : 'unknown')
  return {
    taskId: pick(state.taskId),
    phase: pick(state.phase),
    plan: pick(state.plan),
    tier: pick(state.tier),
  }
}
